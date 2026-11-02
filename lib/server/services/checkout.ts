import "server-only";
import { shippingForSubtotal } from "@/lib/cart-summary";
import { PAYMENT_WINDOW_MINUTES } from "@/lib/config";
import type { Order, OrderItem, Product, SellerOrder, Shop } from "@/lib/types";
import type { CheckoutInput, CheckoutLineInput } from "@/lib/validation/checkout";
import { db, withTx, type Tx } from "../db/tx";
import { ConflictError, ValidationError } from "../errors";
import { assertEmailVerified, type Actor } from "../permissions";
import { publicProductsForCheckout, reserveStock, stockOf } from "../repositories/catalogue";
import {
  findOrderByIdempotencyKey,
  insertOrderItems,
  insertOrderOnce,
  insertSellerOrders,
  nextOrderNumber,
} from "../repositories/commerce";
import { enqueue } from "../repositories/jobs";
import { newId } from "../repositories/people";
import { assertRateLimit } from "./shared";

// Backend plan 9.1 (B07): checkout turns the browser's cart into an order waiting for payment. The browser sends only
// which items, which variants, how many and the personalisation; everything else comes from the database.

export interface PlacedOrder {
  order: Order;
  /** false when this idempotency key had already made the order (a double submit or a retry). */
  created: boolean;
}

interface PricedLine {
  line: CheckoutLineInput;
  product: Product;
  shop: Shop;
  variant: Product["variants"][number];
  customization?: Record<string, string>;
}

/**
 * Places an order for a signed-in customer with a confirmed email (AU-01): current prices (BR-04), one seller order
 * per shop with its own delivery fee (BR-05), stock taken with conditional updates (BR-06), personalisation checked
 * (BR-16), and an expiry job at expires_at, all in one transaction. The same idempotency key twice returns the
 * first order.
 */
export async function placeOrder(actor: Actor, input: CheckoutInput, now = new Date()): Promise<PlacedOrder> {
  assertEmailVerified(actor);
  const earlier = await findOrderByIdempotencyKey(db, actor.id, input.idempotencyKey);
  if (earlier) return { order: earlier, created: false };

  return withTx(async (tx) => {
    await assertRateLimit(tx, actor.id, "checkout", now);
    const lines = await priceLines(tx, input.lines);

    const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);
    const byShop = groupByShop(lines);
    const subtotalCents = sum([...byShop.values()].map((g) => g.subtotalCents));
    const shippingCents = sum([...byShop.values()].map((g) => g.shippingCents));
    const order: Order = {
      id: newId("order"),
      orderNumber: await nextOrderNumber(tx, now.getUTCFullYear()),
      customerId: actor.id,
      shippingAddress: input.shippingAddress,
      subtotalCents,
      shippingCents,
      totalCents: subtotalCents + shippingCents,
      placedAt: now.toISOString(),
      paymentStatus: "PENDING",
      expiresAt: expiresAt.toISOString(),
    };

    // The order row goes first: it claims the idempotency key, so a duplicate request waits here for this one and
    // then takes nothing from stock.
    if (!(await insertOrderOnce(tx, order, input.idempotencyKey))) {
      const existing = await findOrderByIdempotencyKey(tx, actor.id, input.idempotencyKey);
      if (existing) return { order: existing, created: false };
      throw new ConflictError("This checkout was just submitted. Check My account → Orders before trying again.");
    }

    await reserveLines(tx, lines);

    const sellerOrders: SellerOrder[] = [];
    const items: (OrderItem & { stockReserved: boolean })[] = [];
    for (const group of byShop.values()) {
      const sellerOrder: SellerOrder = {
        id: newId("so"),
        orderId: order.id,
        shopId: group.shop.id,
        status: "PENDING_PAYMENT",
        subtotalCents: group.subtotalCents,
        shippingCents: group.shippingCents,
        updatedAt: now.toISOString(),
      };
      sellerOrders.push(sellerOrder);
      for (const l of group.lines) {
        items.push({
          id: newId("item"),
          sellerOrderId: sellerOrder.id,
          productId: l.product.id,
          variantSku: l.variant.sku,
          productTitle: l.product.title,
          variantLabel: l.variant.label,
          unitPriceCents: l.variant.priceCents,
          quantity: l.line.quantity,
          customization: l.customization,
          stockReserved: tracksStock(l.product),
        });
      }
    }
    await insertSellerOrders(tx, sellerOrders);
    await insertOrderItems(tx, items);
    // JOB-02: the expiry job exists only if this order does.
    await enqueue(tx, "orders.expireUnpaid", { orderId: order.id }, { startAfter: expiresAt });
    return { order, created: true };
  });
}

/** BR-06: only ready-to-ship items have stock; made-to-order items are made after purchase. */
function tracksStock(product: Product): boolean {
  return product.type === "READY_TO_SHIP";
}

/** BR-04: each line priced from the database; RULE-P4 / RULE-S4: only items on sale in open shops. */
async function priceLines(tx: Tx, lines: CheckoutLineInput[]): Promise<PricedLine[]> {
  const found = await publicProductsForCheckout(tx, [...new Set(lines.map((l) => l.productSlug))]);
  const bySlug = new Map(found.map((f) => [f.product.slug, f]));
  return lines.map((line) => {
    const hit = bySlug.get(line.productSlug);
    const variant = hit?.product.variants.find((v) => v.sku === line.sku);
    if (!hit || !variant) {
      throw new ConflictError(
        `${hit ? `“${hit.product.title}” in that option` : "An item in your cart"} is no longer for sale. ` +
          "Remove it from your cart and try again.",
      );
    }
    return { line, ...hit, variant, customization: checkCustomization(hit.product, line.customization) };
  });
}

/**
 * BR-16: personalisation must match the item's own fields: required ones filled in, text within its length, a
 * choice from the offered options, and nothing the item doesn't ask for. Returned as plain text by the field's label
 * at checkout (a snapshot, like the item title), so the maker reads what the customer saw.
 */
export function checkCustomization(
  product: Product,
  given: Record<string, string>,
): Record<string, string> | undefined {
  const fields = product.isCustomizable ? (product.customization ?? []) : [];
  const fail = (message: string) => {
    throw new ValidationError(message, { lines: message });
  };
  for (const key of Object.keys(given)) {
    if (!fields.some((f) => f.key === key) && given[key]!.trim()) {
      fail(`“${product.title}” doesn’t offer that personalisation. Remove the item and add it again.`);
    }
  }
  const out: Record<string, string> = {};
  for (const field of fields) {
    // Plain text only: control characters are dropped and whitespace trimmed.
    const value = (given[field.key] ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
    if (!value) {
      if (field.isRequired) fail(`Fill in “${field.label}” for “${product.title}” in your cart.`);
      continue;
    }
    if (field.kind === "SELECT" && !(field.options ?? []).includes(value)) {
      fail(`Choose one of the offered options for “${field.label}” on “${product.title}”.`);
    }
    if (value.length > field.maxLength) {
      fail(`“${field.label}” for “${product.title}” can be at most ${field.maxLength} characters.`);
    }
    out[field.label] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** BR-05: lines grouped by shop, in cart order, each shop with its own subtotal and delivery fee. */
function groupByShop(lines: PricedLine[]) {
  const groups = new Map<string, { shop: Shop; lines: PricedLine[]; subtotalCents: number; shippingCents: number }>();
  for (const l of lines) {
    const g = groups.get(l.shop.id) ?? { shop: l.shop, lines: [], subtotalCents: 0, shippingCents: 0 };
    g.lines.push(l);
    g.subtotalCents += l.variant.priceCents * l.line.quantity;
    groups.set(l.shop.id, g);
  }
  for (const g of groups.values()) g.shippingCents = shippingForSubtotal(g.subtotalCents);
  return groups;
}

/**
 * BR-06: takes each ready-to-ship variant's total quantity from stock with a conditional update. Variants are
 * updated in one fixed order (product id, then sku), so two carts holding the same items can't deadlock. If any
 * variant is short, the error rolls back the whole checkout, including stock already taken.
 */
async function reserveLines(tx: Tx, lines: PricedLine[]): Promise<void> {
  const wanted = new Map<string, { product: Product; variant: PricedLine["variant"]; quantity: number }>();
  for (const l of lines) {
    if (!tracksStock(l.product)) continue;
    const key = `${l.product.id}\u0000${l.variant.sku}`;
    const w = wanted.get(key) ?? { product: l.product, variant: l.variant, quantity: 0 };
    w.quantity += l.line.quantity;
    wanted.set(key, w);
  }
  const ordered = [...wanted.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, w]) => w);
  for (const { product, variant, quantity } of ordered) {
    if (await reserveStock(tx, product.id, variant.sku, quantity)) continue;
    const left = (await stockOf(tx, product.id, variant.sku)) ?? 0;
    const name = product.variants.length > 1 ? `“${product.title}” (${variant.label})` : `“${product.title}”`;
    throw new ConflictError(
      left === 0
        ? `${name} just sold out. Remove it from your cart to continue.`
        : `Only ${left} left of ${name}. Lower the quantity in your cart to continue.`,
    );
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
