import type { LookupProduct } from "./catalogue";
import { FREE_SHIPPING_THRESHOLD_CENTS, SHIPPING_FEE_PER_SHOP_CENTS } from "./config";
import type { CartLine } from "./store";
import type { ProductVariant } from "./types";

export interface PricedLine extends CartLine {
  product: LookupProduct;
  variant: ProductVariant;
  lineTotalCents: number;
}

export interface ShopGroup {
  shop: LookupProduct["shop"];
  lines: PricedLine[];
  subtotalCents: number;
  shippingCents: number;
}

/** BR-05: one flat delivery fee per shop, free from the threshold up. Used by the cart and by checkout. */
export function shippingForSubtotal(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FEE_PER_SHOP_CENTS;
}

/**
 * Prices the cart from current catalogue prices, never from stored values (BR-04),
 * and splits it per shop with a flat delivery fee each (BR-05). Items no longer for sale are dropped.
 */
export function summarizeCart(cart: CartLine[], products: Map<string, LookupProduct>) {
  const groups = new Map<string, ShopGroup>();
  for (const line of cart) {
    const product = products.get(line.productSlug);
    const variant = product?.variants.find((v) => v.sku === line.sku);
    if (!product || !variant) continue;
    const priced: PricedLine = { ...line, product, variant, lineTotalCents: variant.priceCents * line.quantity };
    const group = groups.get(product.shop.slug) ?? {
      shop: product.shop,
      lines: [],
      subtotalCents: 0,
      shippingCents: 0,
    };
    group.lines.push(priced);
    group.subtotalCents += priced.lineTotalCents;
    groups.set(product.shop.slug, group);
  }
  const list = [...groups.values()].map((g) => ({
    ...g,
    shippingCents: shippingForSubtotal(g.subtotalCents),
  }));
  const subtotalCents = list.reduce((s, g) => s + g.subtotalCents, 0);
  const shippingCents = list.reduce((s, g) => s + g.shippingCents, 0);
  const unavailable = cart.filter((l) => !products.get(l.productSlug)?.variants.some((v) => v.sku === l.sku));
  return { groups: list, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents, unavailable };
}
