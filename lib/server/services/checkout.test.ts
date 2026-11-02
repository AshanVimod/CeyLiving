// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAYMENT_WINDOW_MINUTES, SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";
import { db } from "@/lib/server/db/tx";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/server/errors";
import { findOrderByNumber, sellerOrdersOfShop } from "@/lib/server/repositories/commerce";
import { isCatalogueRefreshAllowed, requestCatalogueRefresh } from "@/lib/server/services/catalogue-refresh";
import { placeOrder } from "@/lib/server/services/checkout";
import { expireUnpaidOrder, UNPAID_CANCEL_REASON } from "@/lib/server/services/orders";
import { parseEnv } from "@/lib/env";
import { checkoutSchema, type CheckoutInput } from "@/lib/validation/checkout";
import { migratorClient, queuedJobs, readAll, user, withTestDatabase } from "@/test/db";
import { runJobNow } from "@/test/jobs";
import { captureLogger } from "@/test/log-capture";

// B07 (backend plan 9.1): checkout creates orders waiting for payment, reserves stock, and expires unpaid orders.

withTestDatabase();

const ADDRESS = {
  recipientName: "Test Buyer",
  line1: "1 Lake Road",
  city: "Kandy",
  district: "Kandy",
  phone: "0771234567",
};

type Line = { productSlug: string; sku: string; quantity: number; customization?: Record<string, string> };

/** The checkout input as the action builds it: through the same zod schema (BR-04: unknown fields dropped). */
const checkout = (lines: Line[], idempotencyKey = randomUUID()): CheckoutInput =>
  checkoutSchema.parse({ idempotencyKey, lines, shippingAddress: ADDRESS });

// One left in the seed (a painting from rata-studio).
const LAST_ONE = { productSlug: "monsoon-abstract-canvas", sku: "MAC-1", quantity: 1 };
// Made to order, with a required text and a required choice.
const NAMEPLATE = {
  productSlug: "engraved-wooden-nameplate",
  sku: "EWN-40",
  quantity: 1,
  customization: { text: "Vimod", script: "Sinhala" },
};

const customer = () => user("user_customer");
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function stock(productSlug: string, sku: string): Promise<number> {
  const product = (await readAll()).products.find((p) => p.slug === productSlug)!;
  return product.variants.find((v) => v.sku === sku)!.stock;
}

async function shopId(slug: string): Promise<string> {
  return (await readAll()).shops.find((s) => s.slug === slug)!.id;
}

/** What B08's payment confirmation will do: PENDING -> PAID with a conditional update (PAY-04, DB-06). */
const markPaid = (orderId: string) =>
  migratorClient()
    .$executeRaw`UPDATE orders SET payment_status = 'PAID' WHERE id = ${orderId} AND payment_status = 'PENDING'`;

describe("placeOrder (BR-04, BR-05, BR-06, BR-16)", () => {
  it("BR-06 two checkouts at once for the last item: one order, one clear sold-out message", async () => {
    const results = await Promise.allSettled([
      placeOrder(customer(), checkout([LAST_ONE])),
      placeOrder(user("user_reviewer_1"), checkout([LAST_ONE])),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason = (lost[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(ConflictError);
    expect(reason.message).toBe("“Monsoon, acrylic on canvas” just sold out. Remove it from your cart to continue.");
    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(0);
    const data = await readAll();
    expect(data.orders.filter((o) => o.paymentStatus === "PENDING")).toHaveLength(1);
    expect(await queuedJobs("orders.expireUnpaid")).toHaveLength(1);
  });

  it("BR-06 asking for more than is left names how many are left and changes nothing", async () => {
    const before = await readAll();
    const tooMany = { productSlug: "batik-wall-hanging-naga", sku: "BWH-120", quantity: 3 };
    await expect(placeOrder(customer(), checkout([LAST_ONE, tooMany]))).rejects.toThrow(
      "Only 2 left of “Batik wall hanging, night garden”. Lower the quantity in your cart to continue.",
    );
    // The painting reserved first was given back by the rollback; no order, no job.
    const after = await readAll();
    expect(after.products).toEqual(before.products);
    expect(after.orders).toEqual(before.orders);
    expect(await queuedJobs("orders.expireUnpaid")).toEqual([]);
  });

  it("BR-06 two lines of the same variant are reserved together", async () => {
    const hanger = { productSlug: "macrame-plant-hanger", sku: "MPH-1", quantity: 7 };
    await expect(placeOrder(customer(), checkout([hanger, { ...hanger, quantity: 6 }]))).rejects.toThrow(
      "Only 12 left of “Macramé plant hanger”",
    );
    await placeOrder(customer(), checkout([hanger, { ...hanger, quantity: 5 }]));
    expect(await stock("macrame-plant-hanger", "MPH-1")).toBe(0);
  });

  it("BR-06 creates an unpaid order that expires in 30 minutes, with seller orders waiting for payment", async () => {
    const now = new Date();
    const { order, created } = await placeOrder(customer(), checkout([LAST_ONE]), now);
    expect(created).toBe(true);
    expect(order).toMatchObject({
      customerId: "user_customer",
      paymentStatus: "PENDING",
      expiresAt: new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
      shippingAddress: ADDRESS,
    });
    expect(order.orderNumber).toMatch(/^CM-\d{4}-\d{6}$/);
    const stored = (await findOrderByNumber(db, order.orderNumber))!;
    expect(stored.order).toEqual(order);
    expect(stored.sellerOrders.map((s) => s.sellerOrder.status)).toEqual(["PENDING_PAYMENT"]);
    // JOB-02: the expiry job was created with the order, for its expiry time.
    const [job] = await queuedJobs("orders.expireUnpaid");
    expect(job).toMatchObject({ data: { orderId: order.id } });
    expect(job!.startAfter.toISOString()).toBe(order.expiresAt);
  });

  it("BR-04 prices and totals come from the database; a price sent with the line is ignored", async () => {
    const input = checkoutSchema.parse({
      idempotencyKey: randomUUID(),
      lines: [{ ...LAST_ONE, priceCents: 100, unitPriceCents: 100 }],
      shippingAddress: ADDRESS,
      totalCents: 100,
    });
    const { order } = await placeOrder(customer(), input);
    const { sellerOrders } = (await findOrderByNumber(db, order.orderNumber))!;
    expect(sellerOrders[0]!.items[0]!.unitPriceCents).toBe(3_800_000);
    // Over the free-delivery threshold, so no delivery fee (BR-05).
    expect(order).toMatchObject({ subtotalCents: 3_800_000, shippingCents: 0, totalCents: 3_800_000 });
  });

  it("BR-05 a cart from two shops makes one order and one seller order per shop, each with its delivery fee", async () => {
    const { order } = await placeOrder(
      customer(),
      checkout([
        { productSlug: "macrame-plant-hanger", sku: "MPH-1", quantity: 2 },
        { productSlug: "beaded-bracelet-stack", sku: "BBS-1", quantity: 1 },
      ]),
    );
    const { sellerOrders } = (await findOrderByNumber(db, order.orderNumber))!;
    const byShop = new Map(sellerOrders.map((s) => [s.sellerOrder.shopId, s.sellerOrder]));
    expect(byShop.get(await shopId("nool-and-knot"))).toMatchObject({
      subtotalCents: 520_000,
      shippingCents: SHIPPING_FEE_PER_SHOP_CENTS,
    });
    expect(byShop.get(await shopId("mihiri-jewellery"))).toMatchObject({
      subtotalCents: 220_000,
      shippingCents: SHIPPING_FEE_PER_SHOP_CENTS,
    });
    expect(order).toMatchObject({
      subtotalCents: 740_000,
      shippingCents: 2 * SHIPPING_FEE_PER_SHOP_CENTS,
      totalCents: 740_000 + 2 * SHIPPING_FEE_PER_SHOP_CENTS,
    });
  });

  it("BR-06 a made-to-order item takes no stock, and BR-16 its personalisation is kept for the maker", async () => {
    const before = await stock(NAMEPLATE.productSlug, NAMEPLATE.sku);
    const { order } = await placeOrder(customer(), checkout([NAMEPLATE]));
    expect(await stock(NAMEPLATE.productSlug, NAMEPLATE.sku)).toBe(before);
    const { sellerOrders } = (await findOrderByNumber(db, order.orderNumber))!;
    // Stored by the field labels the customer saw.
    expect(sellerOrders[0]!.items[0]!.customization).toEqual({ "Name or house name": "Vimod", Lettering: "Sinhala" });
  });

  it("BR-16 rejects personalisation that doesn't match the item's fields", async () => {
    const attempt = (customization: Record<string, string>) =>
      placeOrder(customer(), checkout([{ ...NAMEPLATE, customization }]));
    await expect(attempt({ script: "Sinhala" })).rejects.toThrow("Fill in “Name or house name”");
    await expect(attempt({ text: "x".repeat(31), script: "Sinhala" })).rejects.toThrow("at most 30 characters");
    await expect(attempt({ text: "Vimod", script: "Klingon" })).rejects.toThrow("Choose one of the offered options");
    await expect(attempt({ text: "Vimod", script: "Sinhala", colour: "red" })).rejects.toThrow(
      "doesn’t offer that personalisation",
    );
    await expect(
      placeOrder(customer(), checkout([{ ...LAST_ONE, customization: { note: "gift wrap" } }])),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await readAll()).orders.filter((o) => o.paymentStatus === "PENDING")).toEqual([]);
  });

  it("RULE-P4 RULE-S4 items not on sale, or from a suspended shop, can't be bought", async () => {
    await expect(
      placeOrder(customer(), checkout([{ productSlug: "coconut-shell-owl", sku: "CSO-1", quantity: 1 }])),
    ).rejects.toThrow("An item in your cart is no longer for sale");
    await expect(placeOrder(customer(), checkout([{ ...LAST_ONE, sku: "MAC-2" }]))).rejects.toThrow(
      "“Monsoon, acrylic on canvas” in that option is no longer for sale",
    );
  });

  it("AU-01 a customer who hasn't confirmed their email can't check out", async () => {
    await expect(placeOrder({ ...customer(), emailVerified: false }, checkout([LAST_ONE]))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(1);
  });
});

describe("idempotency key", () => {
  const hanger = { productSlug: "macrame-plant-hanger", sku: "MPH-1", quantity: 2 };

  it("the same key twice, one after the other, creates one order and reserves stock once", async () => {
    const input = checkout([hanger]);
    const first = await placeOrder(customer(), input);
    const second = await placeOrder(customer(), input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ order: first.order, created: false });
    expect(await stock("macrame-plant-hanger", "MPH-1")).toBe(10);
    expect(await queuedJobs("orders.expireUnpaid")).toHaveLength(1);
  });

  it("the same key twice at the same moment (a double click) creates one order and reserves stock once", async () => {
    const input = checkout([hanger]);
    const [a, b] = await Promise.all([placeOrder(customer(), input), placeOrder(customer(), input)]);
    expect(a.order.id).toBe(b.order.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect((await readAll()).orders.filter((o) => o.paymentStatus === "PENDING")).toHaveLength(1);
    expect(await stock("macrame-plant-hanger", "MPH-1")).toBe(10);
  });

  it("another customer's key never returns someone else's order", async () => {
    const key = randomUUID();
    const mine = await placeOrder(customer(), checkout([hanger], key));
    const theirs = await placeOrder(user("user_reviewer_1"), checkout([hanger], key));
    expect(theirs.created).toBe(true);
    expect(theirs.order.id).not.toBe(mine.order.id);
  });
});

describe("orders.expireUnpaid (BR-06)", () => {
  /** An order placed 31 minutes ago, so it is already past its expiry time. */
  const overdue = (lines: Line[]) => placeOrder(customer(), checkout(lines), minutesAgo(PAYMENT_WINDOW_MINUTES + 1));

  it("JOB-03 BR-06 run twice: cancels the order once and the stock comes back once", async () => {
    const { order } = await overdue([LAST_ONE, { productSlug: "macrame-plant-hanger", sku: "MPH-1", quantity: 3 }]);
    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(0);

    const first = await runJobNow("orders.expireUnpaid", { orderId: order.id });
    const second = await runJobNow("orders.expireUnpaid", { orderId: order.id });
    expect(first.find((l) => l.msg === "job.completed")).toMatchObject({ expired: true, stockReturned: 4 });
    expect(second.find((l) => l.msg === "job.completed")).toMatchObject({ expired: false, stockReturned: 0 });

    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(1);
    expect(await stock("macrame-plant-hanger", "MPH-1")).toBe(12);
    const { order: stored, sellerOrders } = (await findOrderByNumber(db, order.orderNumber))!;
    expect(stored.paymentStatus).toBe("EXPIRED");
    for (const { sellerOrder } of sellerOrders) {
      expect(sellerOrder).toMatchObject({ status: "CANCELLED", cancelReason: UNPAID_CANCEL_REASON });
    }
    const told = (await readAll()).notifications.filter((n) => n.type === "order.expired");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ userId: "user_customer", href: `/account/orders/${order.orderNumber}` });
    // The web app is asked to drop its cached catalogue, once.
    expect(await queuedJobs("catalogue.refresh")).toHaveLength(1);
  });

  it("BR-06 the stock that came back can be bought again", async () => {
    const { order } = await overdue([LAST_ONE]);
    await expireUnpaidOrder(order.id);
    const again = await placeOrder(user("user_reviewer_1"), checkout([LAST_ONE]));
    expect(again.created).toBe(true);
  });

  it("BR-06 an expired made-to-order item gives back no stock and asks for no cache refresh", async () => {
    const before = await stock(NAMEPLATE.productSlug, NAMEPLATE.sku);
    const { order } = await overdue([NAMEPLATE]);
    expect(await expireUnpaidOrder(order.id)).toEqual({ expired: true, stockReturned: 0 });
    expect(await stock(NAMEPLATE.productSlug, NAMEPLATE.sku)).toBe(before);
    expect(await queuedJobs("catalogue.refresh")).toEqual([]);
  });

  it("BR-06 an order paid just before its deadline is never expired", async () => {
    const { order } = await placeOrder(customer(), checkout([LAST_ONE]), minutesAgo(PAYMENT_WINDOW_MINUTES - 1));
    expect(await markPaid(order.id)).toBe(1);
    // The job then runs at (or after) the deadline.
    const result = await expireUnpaidOrder(order.id, new Date(Date.parse(order.expiresAt!) + 1000));
    expect(result).toEqual({ expired: false, stockReturned: 0 });
    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(0);
    const { order: stored, sellerOrders } = (await findOrderByNumber(db, order.orderNumber))!;
    expect(stored.paymentStatus).toBe("PAID");
    expect(sellerOrders[0]!.sellerOrder.status).toBe("PENDING_PAYMENT"); // B08 moves it to NEW
  });

  it("DB-06 a payment confirmed while the expiry runs: exactly one of them wins", async () => {
    const { order } = await overdue([LAST_ONE]);
    // The payment (B08) takes the order's row lock first and holds it; the expiry has to wait for it.
    let paymentHoldsLock!: () => void;
    const locked = new Promise<void>((resolve) => (paymentHoldsLock = resolve));
    let finishPayment!: () => void;
    const paymentMayCommit = new Promise<void>((resolve) => (finishPayment = resolve));
    const payment = migratorClient().$transaction(async (tx) => {
      const paid =
        await tx.$executeRaw`UPDATE orders SET payment_status = 'PAID' WHERE id = ${order.id} AND payment_status = 'PENDING'`;
      paymentHoldsLock();
      await paymentMayCommit;
      return paid;
    });
    await locked;
    const expiry = expireUnpaidOrder(order.id);
    await new Promise((resolve) => setTimeout(resolve, 300)); // the expiry is now waiting on the row lock
    finishPayment();
    expect(await payment).toBe(1);
    expect(await expiry).toEqual({ expired: false, stockReturned: 0 });
    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(0);
  });

  it("PAY-06 a payment arriving after the expiry finds the order no longer waiting, so B08 can flag it", async () => {
    const { order } = await overdue([LAST_ONE]);
    await expireUnpaidOrder(order.id);
    expect(await markPaid(order.id)).toBe(0);
    expect((await findOrderByNumber(db, order.orderNumber))!.order.paymentStatus).toBe("EXPIRED");
  });

  it("JOB-03 a run before the expiry time changes nothing and is retried later", async () => {
    const { order } = await placeOrder(customer(), checkout([LAST_ONE]));
    await expect(runJobNow("orders.expireUnpaid", { orderId: order.id })).rejects.toThrow("isn't due to expire");
    expect((await findOrderByNumber(db, order.orderNumber))!.order.paymentStatus).toBe("PENDING");
    expect(await stock(LAST_ONE.productSlug, LAST_ONE.sku)).toBe(0);
  });

  it("JOB-03 a job for an order that doesn't exist does nothing", async () => {
    expect(await expireUnpaidOrder("order_missing")).toEqual({ expired: false, stockReturned: 0 });
  });
});

describe("seller visibility (backend plan 9.1)", () => {
  it("BR-06 sellers don't see orders waiting for payment or cancelled unpaid; they see them once paid", async () => {
    const rata = await shopId("rata-studio");
    const waiting = await placeOrder(customer(), checkout([LAST_ONE]));
    const ids = async () => (await sellerOrdersOfShop(db, rata)).map((so) => so.orderId);
    expect(await ids()).not.toContain(waiting.order.id);

    await markPaid(waiting.order.id);
    expect(await ids()).toContain(waiting.order.id);

    const sigiriya = { productSlug: "sigiriya-at-dusk", sku: "SAD-1", quantity: 1 };
    const expired = await placeOrder(customer(), checkout([sigiriya]), minutesAgo(PAYMENT_WINDOW_MINUTES + 1));
    await expireUnpaidOrder(expired.order.id);
    expect(await ids()).not.toContain(expired.order.id);
  });
});

describe("catalogue.refresh (B07)", () => {
  const env = (extra: Record<string, string> = {}) => parseEnv({ NODE_ENV: "test", ...extra });
  const SECRET = "s".repeat(40);

  it("asks the web app's internal route to refresh, with the shared secret", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const send = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const { logger } = captureLogger();
    const result = await requestCatalogueRefresh(
      logger,
      env({ CACHE_REFRESH_SECRET: SECRET, INTERNAL_APP_URL: "http://web:3000/" }),
      send,
    );
    expect(result).toBe("refreshed");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://web:3000/api/internal/catalogue-refresh");
    expect(calls[0]!.init).toMatchObject({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  });

  it("JOB-04 fails (for a retry) when the web app doesn't answer OK, without the secret in the error", async () => {
    const send = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const { logger } = captureLogger();
    const attempt = requestCatalogueRefresh(logger, env({ CACHE_REFRESH_SECRET: SECRET }), send);
    await expect(attempt).rejects.toThrow("answered 503");
    await expect(attempt).rejects.not.toThrow(SECRET);
  });

  it("is skipped when no secret is set (development)", async () => {
    const { logger } = captureLogger();
    const send = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    expect(await requestCatalogueRefresh(logger, env(), send)).toBe("skipped");
  });

  it("SEC-A1 the internal route accepts only the exact secret", () => {
    const configured = env({ CACHE_REFRESH_SECRET: SECRET });
    expect(isCatalogueRefreshAllowed(`Bearer ${SECRET}`, configured)).toBe(true);
    expect(isCatalogueRefreshAllowed(`Bearer ${SECRET}x`, configured)).toBe(false);
    expect(isCatalogueRefreshAllowed(SECRET, configured)).toBe(false);
    expect(isCatalogueRefreshAllowed(null, configured)).toBe(false);
    expect(isCatalogueRefreshAllowed("Bearer ", env())).toBe(false);
  });
});
