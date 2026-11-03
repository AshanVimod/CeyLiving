// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SELLER_ACCEPT_DEADLINE_DAYS } from "@/lib/config";
import { getEnv } from "@/lib/env";
import type { Order } from "@/lib/types";
import { db } from "@/lib/server/db/tx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/server/errors";
import { formatAmount, PayHereApiError, signedNotification, type PayHereApi } from "@/lib/server/payments/payhere";
import { findOrderByNumber, sellerOrdersOfShop } from "@/lib/server/repositories/commerce";
import { placeOrder } from "@/lib/server/services/checkout";
import { expireUnpaidOrder, transitionSellerOrder } from "@/lib/server/services/orders";
import {
  compareWithPayHere,
  payPageFor,
  paymentResultFor,
  previousColomboDay,
  receivePayHereNotification,
  reconcilePayments,
  refundSellerOrder,
  refundUnusablePayment,
  releasePayoutHold,
  resolvePendingRefund,
  simulatePayment,
} from "@/lib/server/services/payments";
import { commissionFor, markPayoutPaid, runPayouts } from "@/lib/server/services/payouts";
import { WORKER } from "@/lib/server/services/shared";
import { checkoutSchema } from "@/lib/validation/checkout";
import { migratorClient, readAll, user, withTestDatabase } from "@/test/db";
import { captureLogger } from "@/test/log-capture";

// B08 (backend plan 9.2): PayHere notifications, late payments, refunds, chargebacks and reconciliation, against a
// real PostgreSQL (Testcontainers).

withTestDatabase();

const ADDRESS = {
  recipientName: "Test Buyer",
  line1: "1 Lake Road",
  city: "Kandy",
  district: "Kandy",
  phone: "0771234567",
};
const LAST_ONE = { productSlug: "monsoon-abstract-canvas", sku: "MAC-1", quantity: 1 };
const HANGER = { productSlug: "macrame-plant-hanger", sku: "MPH-1", quantity: 1 };
const RATA = "shop_rata-studio";

const customer = () => user("user_customer");
const admin = () => user("user_admin");
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function order(line = LAST_ONE, now = new Date()): Promise<Order> {
  const input = checkoutSchema.parse({ idempotencyKey: randomUUID(), lines: [line], shippingAddress: ADDRESS });
  return (await placeOrder(customer(), input, now)).order;
}

/** What PayHere posts for this order, correctly signed (unless a test changes it afterwards). */
function notification(o: Order, overrides: Record<string, string> = {}) {
  const { md5sig, ...rest } = overrides;
  const signed = signedNotification({
    order_id: o.orderNumber,
    payment_id: "320025071278",
    payhere_amount: formatAmount(o.totalCents),
    payhere_currency: "LKR",
    status_code: "2",
    method: "VISA",
    status_message: "Successfully completed the payment.",
    ...rest,
  });
  return { ...signed, card_no: "************1292", card_holder_name: "T BUYER", ...(md5sig && { md5sig }) };
}

async function receive(fields: Record<string, unknown>, now = new Date()) {
  const capture = captureLogger();
  const outcome = await receivePayHereNotification(fields, capture.logger, now);
  return { outcome, ...capture };
}

const stored = async (o: Order) => (await findOrderByNumber(db, o.orderNumber))!;
const paymentsOf = async (o: Order) => await migratorClient().payment.findMany({ where: { orderId: o.id } });

async function shopOwner(shopId: string) {
  return (await readAll()).shops.find((s) => s.id === shopId)!.ownerId;
}

async function stockOf(line: typeof LAST_ONE) {
  const product = (await readAll()).products.find((p) => p.slug === line.productSlug)!;
  return product.variants.find((v) => v.sku === line.sku)!.stock;
}

describe("payment notification (PAY-03, PAY-04)", () => {
  it("PAY-03 a valid success notification pays the order, opens it for the maker and tells both", async () => {
    const o = await order();
    const now = new Date();
    const { outcome, raw } = await receive(notification(o), now);
    expect(outcome).toEqual({ result: "paid", orderNumber: o.orderNumber });
    const { order: paid, sellerOrders } = await stored(o);
    expect(paid).toMatchObject({ paymentStatus: "PAID", paidAt: now.toISOString() });
    expect(sellerOrders[0]!.sellerOrder).toMatchObject({
      status: "NEW",
      acceptDeadlineAt: new Date(now.getTime() + SELLER_ACCEPT_DEADLINE_DAYS * 86_400_000).toISOString(),
    });
    // The seller sees it now (it was hidden while unpaid).
    expect((await sellerOrdersOfShop(db, RATA)).map((so) => so.id)).toContain(sellerOrders[0]!.sellerOrder.id);
    const notes = (await readAll()).notifications;
    const owner = await shopOwner(RATA);
    expect(notes.find((n) => n.userId === "user_customer" && n.type === "order.paid")).toBeDefined();
    expect(notes.find((n) => n.userId === owner && n.type === "order.new")).toMatchObject({
      href: `/seller/orders/${sellerOrders[0]!.sellerOrder.id}`,
    });
    // PAY-01: card details are neither stored nor logged.
    const [payment] = await paymentsOf(o);
    expect(payment).toMatchObject({ status: "SUCCESS", statusCode: 2, amountCents: o.totalCents, method: "VISA" });
    expect(JSON.stringify(payment!.raw)).not.toMatch(/1292|T BUYER/);
    expect(raw.join("")).not.toMatch(/1292|T BUYER/);
  });

  it.each([
    ["bad signature", { md5sig: "0".repeat(32) }, "signature"],
    ["another merchant", { merchant_id: "1211150" }, "merchant"],
    ["wrong amount (correctly signed)", { payhere_amount: "1.00" }, "amount"],
    ["wrong currency (correctly signed)", { payhere_currency: "USD" }, "currency"],
    ["unknown order (correctly signed)", { order_id: "CM-2026-999999" }, "unknown_order"],
  ])("PAY-03 %s: logs a security event, changes nothing", async (_name, overrides, reason) => {
    const o = await order();
    const before = await readAll();
    let fields: Record<string, string> = notification(o, overrides);
    if ("merchant_id" in overrides) fields = { ...notification(o), merchant_id: overrides.merchant_id! };
    const { outcome, lines } = await receive(fields);
    expect(outcome).toEqual({ result: "rejected", reason });
    expect(await readAll()).toEqual(before);
    expect(await paymentsOf(o)).toEqual([]);
    expect(lines.find((l) => l.event === "security.payment_notification")).toBeDefined();
  });

  it("PAY-03 missing or malformed fields are rejected without touching the database", async () => {
    const o = await order();
    const unsigned = Object.fromEntries(Object.entries(notification(o)).filter(([key]) => key !== "md5sig"));
    const { outcome, lines } = await receive(unsigned);
    expect(outcome).toEqual({ result: "rejected", reason: "invalid" });
    expect(lines[0]).toMatchObject({ event: "security.payment_notification", reason: "invalid", fields: ["md5sig"] });
    expect((await stored(o)).order.paymentStatus).toBe("PENDING");
  });

  it("PAY-02 the merchant secret never appears in the logs", async () => {
    const o = await order();
    const { raw } = await receive(notification(o));
    const bad = await receive(notification(o, { md5sig: "0".repeat(32) }));
    const secret = getEnv().PAYHERE_MERCHANT_SECRET ?? "ceyliving-dev-only-payhere-merchant-secret";
    expect([...raw, ...bad.raw].join("")).not.toContain(secret);
  });

  it("PAY-04 the same success notification twice pays once and records one payment", async () => {
    const o = await order();
    await receive(notification(o));
    const notesAfterFirst = (await readAll()).notifications.length;
    const { outcome } = await receive(notification(o));
    expect(outcome).toEqual({ result: "duplicate" });
    expect(await paymentsOf(o)).toHaveLength(1);
    expect((await readAll()).notifications).toHaveLength(notesAfterFirst);
  });

  it("PAY-04 the same notification twice at the same moment pays once", async () => {
    const o = await order();
    const results = await Promise.all([receive(notification(o)), receive(notification(o))]);
    expect(results.map((r) => r.outcome.result).sort()).toEqual(["duplicate", "paid"]);
    expect(await paymentsOf(o)).toHaveLength(1);
    expect((await readAll()).notifications.filter((n) => n.type === "order.new")).toHaveLength(1);
  });

  it("PAY-03 an unknown status code is logged and changes nothing", async () => {
    const o = await order();
    const { outcome } = await receive(notification(o, { status_code: "5" }));
    expect(outcome).toEqual({ result: "unknown_status", statusCode: "5" });
    expect(await paymentsOf(o)).toEqual([]);
  });
});

describe("status codes (PAY-05)", () => {
  it("PAY-05 status 0 (pending) is recorded; the order waits, and a later success pays it", async () => {
    const o = await order();
    expect((await receive(notification(o, { status_code: "0" }))).outcome).toEqual({
      result: "recorded",
      status: "PENDING",
    });
    expect((await stored(o)).order.paymentStatus).toBe("PENDING");
    expect((await receive(notification(o, { status_code: "2" }))).outcome.result).toBe("paid");
    expect(await paymentsOf(o)).toEqual([expect.objectContaining({ status: "SUCCESS", statusCode: 2 })]);
  });

  it.each([
    ["-1", "CANCELLED", "cancelled"],
    ["-2", "FAILED", "failed"],
  ])(
    "PAY-05 status %s (%s) keeps the order held so the customer can try again, and a new payment pays it",
    async (code, status, result) => {
      const o = await order();
      expect((await receive(notification(o, { status_code: code }))).outcome).toEqual({ result: "recorded", status });
      expect((await stored(o)).order.paymentStatus).toBe("PENDING");
      expect(await paymentResultFor(customer(), o.orderNumber)).toMatchObject({ result, canRetry: true });
      const page = await payPageFor(customer(), o.orderNumber);
      expect(page).toMatchObject({ state: "pay", lastFailure: { status } });
      const retry = await receive(notification(o, { payment_id: "320025071299" }));
      expect(retry.outcome.result).toBe("paid");
    },
  );

  it("PAY-05 status 2 after 2 is a duplicate; a 'pending' after success is ignored", async () => {
    const o = await order();
    await receive(notification(o));
    expect((await receive(notification(o, { status_code: "0" }))).outcome).toEqual({
      result: "ignored",
      from: "SUCCESS",
      to: "PENDING",
    });
    expect((await paymentsOf(o))[0]!.status).toBe("SUCCESS");
  });

  it("PAY-05 status -3 (chargeback) holds only that order's shop's payouts and alerts admins", async () => {
    const o = await order();
    await receive(notification(o));
    const { outcome, lines } = await receive(notification(o, { status_code: "-3" }));
    expect(outcome).toEqual({ result: "chargeback", orderNumber: o.orderNumber, heldShops: 1 });
    expect(lines.find((l) => l.msg === "payment.chargeback")).toMatchObject({ level: "error" });
    const data = await readAll();
    expect(data.shops.filter((s) => s.payoutHoldReason).map((s) => s.id)).toEqual([RATA]);
    expect(data.notifications.find((n) => n.userId === "user_admin" && n.type === "payment.chargeback")).toBeDefined();
    expect(data.auditLog.find((a) => a.action === "shop.payout_held")).toMatchObject({ targetId: RATA });
  });

  it("PAY-05 a held shop gets no payout and can't be marked paid until an admin releases it (audited)", async () => {
    // Seed: rata-studio has delivered orders that are ready to pay out.
    const [scheduled] = (await runPayouts(WORKER)).filter((p) => p.shopId === RATA);
    expect(scheduled).toBeDefined();
    await migratorClient().shop.update({
      where: { id: RATA },
      data: { payoutHoldReason: "Chargeback on CM-x", payoutHeldAt: new Date() },
    });
    await expect(markPayoutPaid(admin(), scheduled!.id, "BANK-1234")).rejects.toThrow(/on hold/);
    await migratorClient().sellerOrder.updateMany({ where: { payoutId: scheduled!.id }, data: { payoutId: null } });
    expect((await runPayouts(WORKER)).filter((p) => p.shopId === RATA)).toEqual([]);

    await expect(releasePayoutHold(customer(), RATA, "Reviewed the chargeback")).rejects.toBeInstanceOf(ForbiddenError);
    await releasePayoutHold(admin(), RATA, "Reviewed: the bank reversed the chargeback");
    const audit = (await readAll()).auditLog.find((a) => a.action === "shop.payout_released")!;
    expect(audit).toMatchObject({
      actorId: "user_admin",
      targetId: RATA,
      reason: "Reviewed: the bank reversed the chargeback",
      before: { payoutHoldReason: "Chargeback on CM-x" },
    });
    await expect(releasePayoutHold(admin(), RATA, "Again")).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("late payments and the expiry race (PAY-06)", () => {
  it("PAY-06 a payment after the order expired is recorded and flagged for refund; the order stays cancelled", async () => {
    const o = await order(LAST_ONE, minutesAgo(31));
    await expireUnpaidOrder(o.id);
    const { outcome } = await receive(notification(o));
    expect(outcome).toEqual({ result: "late", orderNumber: o.orderNumber });
    const { order: after, sellerOrders } = await stored(o);
    expect(after.paymentStatus).toBe("EXPIRED");
    expect(sellerOrders[0]!.sellerOrder.status).toBe("CANCELLED");
    expect((await paymentsOf(o))[0]!.needsRefundReason).toMatch(/after the order expired/);
    const data = await readAll();
    expect(
      data.notifications.find((n) => n.userId === "user_admin" && n.type === "payment.needs_refund"),
    ).toBeDefined();
    expect(data.notifications.find((n) => n.userId === "user_customer" && n.type === "payment.late")).toBeDefined();
    expect(await paymentResultFor(customer(), o.orderNumber)).toMatchObject({ result: "expired", latePayment: true });
  });

  it("PAY-06 a second payment for an already paid order is flagged for refund, not applied", async () => {
    const o = await order();
    await receive(notification(o));
    const { outcome } = await receive(notification(o, { payment_id: "320025071300" }));
    expect(outcome.result).toBe("late");
    expect((await paymentsOf(o)).find((p) => p.providerPaymentId === "320025071300")!.needsRefundReason).toMatch(
      /already paid/,
    );
  });

  it("PAY-06 JOB-03 a payment racing orders.expireUnpaid pays or expires the order, exactly once", async () => {
    const startStock = await stockOf(HANGER);
    let paid = 0;
    for (let i = 0; i < 8; i++) {
      // Placed 2 minutes apart, over 30 minutes ago (so due to expire), and outside each other's rate-limit window.
      const o = await order(HANGER, minutesAgo(60 - 2 * i));
      const [, { outcome }] = await Promise.all([
        expireUnpaidOrder(o.id),
        receive(notification(o, { payment_id: `9000${i}` })),
      ]);
      const { order: after, sellerOrders } = await stored(o);
      const [payment] = await paymentsOf(o);
      if (after.paymentStatus === "PAID") {
        paid++;
        expect(outcome.result).toBe("paid");
        expect(payment!.needsRefundReason).toBeNull();
        expect(sellerOrders[0]!.sellerOrder.status).toBe("NEW");
      } else {
        expect(after.paymentStatus).toBe("EXPIRED");
        expect(outcome.result).toBe("late");
        expect(payment!.needsRefundReason).not.toBeNull();
        expect(sellerOrders[0]!.sellerOrder.status).toBe("CANCELLED");
      }
    }
    // Stock went back only for the expired ones.
    expect(await stockOf(HANGER)).toBe(startStock - paid);
  });
});

describe("refunds (PAY-07, BR-18)", () => {
  async function paidAndCancelled() {
    const o = await order();
    await receive(notification(o));
    const so = (await stored(o)).sellerOrders[0]!.sellerOrder;
    // The maker cancels it (BR-07), which puts it in the admin's "needs refund" queue.
    await transitionSellerOrder(user(await shopOwner(RATA)), {
      sellerOrderId: so.id,
      to: "CANCELLED",
      reason: "Cracked in the kiln, sorry",
    });
    return { o, so };
  }

  const manual = { method: "MANUAL" as const, reason: "Maker cancelled the order", reference: "BOC-778812" };

  it("BR-18 only admins refund", async () => {
    const { so } = await paidAndCancelled();
    await expect(refundSellerOrder(customer(), so.id, manual)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("PAY-07 BR-18 a manual refund of a cancelled paid order: recorded, payment and order updated, told, audited", async () => {
    const { o, so } = await paidAndCancelled();
    const refund = await refundSellerOrder(admin(), so.id, manual);
    expect(refund).toMatchObject({
      status: "SUCCEEDED",
      providerRef: "BOC-778812",
      amountCents: so.subtotalCents + so.shippingCents,
      clawbackCents: 0,
    });
    expect((await paymentsOf(o))[0]!.refundedCents).toBe(o.totalCents);
    expect((await stored(o)).order.paymentStatus).toBe("REFUNDED");
    const data = await readAll();
    expect(data.notifications.find((n) => n.userId === "user_customer" && n.type === "refund.issued")).toBeDefined();
    expect(data.auditLog.find((a) => a.action === "refund.issued")).toMatchObject({
      actorId: "user_admin",
      reason: manual.reason,
    });
  });

  it("BR-18 a second refund of the same order is refused, also when two admins click at once", async () => {
    const { so } = await paidAndCancelled();
    const results = await Promise.allSettled([
      refundSellerOrder(admin(), so.id, manual),
      refundSellerOrder(admin(), so.id, { ...manual, reference: "BOC-778813" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(ConflictError) });
    await expect(refundSellerOrder(admin(), so.id, manual)).rejects.toThrow("already refunded");
    expect(await migratorClient().refund.count()).toBe(1);
  });

  it("BR-18 an order still with the maker must be cancelled first", async () => {
    const o = await order();
    await receive(notification(o));
    const so = (await stored(o)).sellerOrders[0]!.sellerOrder;
    await expect(refundSellerOrder(admin(), so.id, manual)).rejects.toThrow("Cancel it first");
  });

  it("PAY-07 through PayHere: success keeps PayHere's refund number; a refusal fails and can be retried", async () => {
    const { o, so } = await paidAndCancelled();
    const calls: unknown[] = [];
    const refusing: PayHereApi = {
      refund: async (input) => {
        calls.push(input);
        throw new PayHereApiError("PayHere refused the refund: Error processing refund.", "refused");
      },
      paymentsOfOrder: async () => [],
    };
    const request = { method: "PAYHERE" as const, reason: "Maker cancelled the order" };
    await expect(refundSellerOrder(admin(), so.id, request, new Date(), refusing)).rejects.toThrow(
      "Error processing refund",
    );
    expect((await migratorClient().refund.findFirst())!.status).toBe("FAILED");
    // The whole payment is refunded, so no partial amount is sent.
    expect(calls).toEqual([{ paymentId: "320025071278", amountCents: undefined, description: request.reason }]);

    const working: PayHereApi = { refund: async () => ({ refundRef: "147258" }), paymentsOfOrder: async () => [] };
    const refund = await refundSellerOrder(admin(), so.id, request, new Date(), working);
    expect(refund).toMatchObject({ status: "SUCCEEDED", providerRef: "147258" });
    expect((await stored(o)).order.paymentStatus).toBe("REFUNDED");
  });

  it("PAY-07 no answer from PayHere leaves the refund pending (no blind retry) until an admin records it", async () => {
    const { so } = await paidAndCancelled();
    const silent: PayHereApi = {
      refund: async () => {
        throw new PayHereApiError("PayHere didn't answer in time.", "unavailable");
      },
      paymentsOfOrder: async () => [],
    };
    const request = { method: "PAYHERE" as const, reason: "Maker cancelled the order" };
    await expect(refundSellerOrder(admin(), so.id, request, new Date(), silent)).rejects.toThrow("stays pending");
    const pending = (await migratorClient().refund.findFirst())!;
    expect(pending.status).toBe("PENDING");
    await expect(refundSellerOrder(admin(), so.id, request, new Date(), silent)).rejects.toThrow("already refunded");
    await resolvePendingRefund(admin(), pending.id, { succeeded: true, reference: "147300" });
    expect(await migratorClient().refund.findFirst()).toMatchObject({ status: "SUCCEEDED", providerRef: "147300" });
  });

  it("PAY-06 BR-18 a late payment is refunded whole, once", async () => {
    const o = await order(LAST_ONE, minutesAgo(31));
    await expireUnpaidOrder(o.id);
    await receive(notification(o));
    const [payment] = await paymentsOf(o);
    const refund = await refundUnusablePayment(admin(), payment!.id, manual);
    expect(refund).toMatchObject({ status: "SUCCEEDED", amountCents: o.totalCents });
    expect((await stored(o)).order.paymentStatus).toBe("EXPIRED");
    await expect(refundUnusablePayment(admin(), payment!.id, manual)).rejects.toThrow("already refunded");
  });

  it("BR-18 a refund of an order already paid out comes off the shop's next payout", async () => {
    const tenDaysAgo = minutesAgo(10 * 24 * 60);
    const complete = (id: string) =>
      migratorClient().sellerOrder.update({
        where: { id },
        data: { status: "COMPLETED", acceptedAt: tenDaysAgo, dispatchedAt: tenDaysAgo, completedAt: tenDaysAgo },
      });
    const first = await order();
    await receive(notification(first));
    const so = (await stored(first)).sellerOrders[0]!.sellerOrder;
    await complete(so.id);
    const [payout1] = (await runPayouts(WORKER)).filter((p) => p.shopId === RATA);
    expect(payout1!.sellerOrderIds).toContain(so.id);

    const refund = await refundSellerOrder(admin(), so.id, { ...manual, reason: "Arrived broken (dispute)" });
    const amount = so.subtotalCents + so.shippingCents;
    expect(refund.clawbackCents).toBe(amount - commissionFor(so));
    expect((await stored(first)).sellerOrders[0]!.sellerOrder.status).toBe("REFUNDED");

    // The next delivered order of the same shop pays out minus the refund.
    const product = (await readAll()).products.find(
      (p) =>
        p.shopSlug === "rata-studio" &&
        p.status === "ACTIVE" &&
        p.slug !== LAST_ONE.productSlug &&
        p.variants.some((v) => v.stock > 0) &&
        !p.customization?.length,
    )!;
    const second = await order({
      productSlug: product.slug,
      sku: product.variants.find((v) => v.stock > 0)!.sku,
      quantity: 1,
    });
    await receive(notification(second, { payment_id: "320025071301" }));
    await complete((await stored(second)).sellerOrders[0]!.sellerOrder.id);
    const [payout2] = (await runPayouts(WORKER)).filter((p) => p.shopId === RATA);
    expect(payout2).toMatchObject({
      refundsCents: refund.clawbackCents,
      netCents: payout2!.grossCents - payout2!.commissionCents - refund.clawbackCents,
    });
    expect((await migratorClient().refund.findFirst())!.deductedPayoutId).toBe(payout2!.id);
  });
});

describe("reconciliation (PAY-08)", () => {
  const remote = (o: Order, overrides: Partial<{ paymentId: string; amountCents: number; status: string }> = {}) => ({
    paymentId: "320025071278",
    orderNumber: o.orderNumber,
    amountCents: o.totalCents,
    currency: "LKR",
    status: "RECEIVED",
    ...overrides,
  });

  it("PAY-08 reports differences to admins and changes no order or payment", async () => {
    // A day a month ahead, so no seeded order falls in it.
    const reconcileAt = new Date(Date.now() + 30 * 86_400_000);
    const yesterday = previousColomboDay(reconcileAt);
    const at = new Date(yesterday.from.getTime() + 3_600_000);
    const paidHereOnly = await order(LAST_ONE, at);
    await receive(notification(paidHereOnly), at);
    const missed = await order(HANGER, new Date(at.getTime() + 120_000));
    const mismatched = await order({ ...HANGER }, new Date(at.getTime() + 240_000));
    await receive(notification(mismatched, { payment_id: "320025071302" }), at);
    const api: PayHereApi = {
      refund: async () => ({ refundRef: "x" }),
      paymentsOfOrder: async (n) =>
        n === missed.orderNumber
          ? [remote(missed, { paymentId: "320025071303" })]
          : n === mismatched.orderNumber
            ? [remote(mismatched, { paymentId: "320025071302", amountCents: 1 })]
            : [],
    };
    const before = await readAll();
    const { logger } = captureLogger();
    const result = await reconcilePayments(logger, reconcileAt, api);
    expect(result).toMatchObject({ checked: 3 });
    expect("differences" in result && result.differences.map((d) => [d.kind, d.orderNumber]).sort()).toEqual(
      [
        ["amount_mismatch", mismatched.orderNumber],
        ["missing_notification", missed.orderNumber],
        ["paid_here_not_at_payhere", paidHereOnly.orderNumber],
      ].sort(),
    );
    const after = await readAll();
    expect(after.orders).toEqual(before.orders);
    expect(await migratorClient().payment.count()).toBe(2);
    expect(after.notifications.find((n) => n.userId === "user_admin" && n.type === "payment.reconcile")).toBeDefined();
    expect(after.auditLog.find((a) => a.action === "payments.reconciled")).toMatchObject({ actorId: undefined });
  });

  it("PAY-08 is skipped without the Merchant API", async () => {
    const before = await readAll();
    const { logger } = captureLogger();
    expect(await reconcilePayments(logger, new Date(), undefined)).toEqual({ skipped: true });
    expect(await readAll()).toEqual(before);
  });

  it("PAY-08 compares statuses: a chargeback or refund at PayHere we don't know about is a difference", () => {
    const o = { orderNumber: "CM-1", paymentStatus: "PAID", totalCents: 1000 } as Order;
    const ours = [{ providerPaymentId: "p1", status: "SUCCESS", amountCents: 1000, refundedCents: 0 }] as never;
    const theirs = (status: string) => [
      { paymentId: "p1", orderNumber: "CM-1", amountCents: 1000, currency: "LKR", status },
    ];
    expect(compareWithPayHere(o, ours, theirs("RECEIVED"))).toEqual([]);
    expect(compareWithPayHere(o, ours, theirs("CHARGEBACKED"))[0]).toMatchObject({ kind: "status_mismatch" });
    expect(compareWithPayHere(o, ours, theirs("REFUNDED"))[0]).toMatchObject({ kind: "status_mismatch" });
  });

  it("works out yesterday in Colombo (UTC+05:30)", () => {
    // 2026-11-03 01:00 in Colombo is 2026-11-02 19:30 UTC; yesterday there is 2026-11-02.
    const day = previousColomboDay(new Date("2026-11-02T19:30:00Z"));
    expect(day).toEqual({
      from: new Date("2026-11-01T18:30:00Z"),
      to: new Date("2026-11-02T18:30:00Z"),
      label: "2026-11-02",
    });
  });
});

describe("pay page, result page and simulator", () => {
  it("SEC-A5 someone else's order looks missing", async () => {
    const o = await order();
    await expect(payPageFor(user("user_reviewer_1"), o.orderNumber)).rejects.toBeInstanceOf(NotFoundError);
    await expect(paymentResultFor(user("user_reviewer_1"), o.orderNumber)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("BR-09 the result page reads the database: waiting until the notification, then paid", async () => {
    const o = await order();
    expect(await paymentResultFor(customer(), o.orderNumber)).toMatchObject({ result: "waiting" });
    await receive(notification(o));
    expect(await paymentResultFor(customer(), o.orderNumber)).toMatchObject({ result: "paid" });
    expect(await payPageFor(customer(), o.orderNumber)).toMatchObject({ state: "done" });
  });

  it("PAY-02 the pay page's form is signed on the server and goes to PayHere's sandbox", async () => {
    const o = await order();
    const page = await payPageFor(customer(), o.orderNumber);
    expect(page.state).toBe("pay");
    if (page.state !== "pay") return;
    expect(page.form.action).toBe("https://sandbox.payhere.lk/pay/checkout");
    expect(page.form.fields).toMatchObject({
      order_id: o.orderNumber,
      amount: formatAmount(o.totalCents),
      first_name: "Test",
      last_name: "Buyer",
      email: customer().email,
    });
  });

  it("the dev simulator pays through the same checks, and is refused in production", async () => {
    const o = await order();
    const { logger } = captureLogger();
    expect(await simulatePayment(customer(), o.orderNumber, "success", logger)).toMatchObject({ result: "paid" });
    const o2 = await order(HANGER);
    await expect(
      simulatePayment(customer(), o2.orderNumber, "success", logger, new Date(), {
        ...getEnv(),
        NODE_ENV: "production",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await stored(o2)).order.paymentStatus).toBe("PENDING");
  });
});
