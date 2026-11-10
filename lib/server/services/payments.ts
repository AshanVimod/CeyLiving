import "server-only";
import type { Logger } from "pino";
import { PAYMENT_WINDOW_MINUTES, SELLER_ACCEPT_DEADLINE_DAYS } from "@/lib/config";
import { getEnv, type Env } from "@/lib/env";
import { formatLkr } from "@/lib/format";
import type { Order, Payment, ProviderPaymentStatus, Refund, RefundMethod, SellerOrder } from "@/lib/types";
import { db, withTx, type Tx } from "../db/tx";
import { queueEmail } from "../email/queue";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import {
  checkoutForm,
  formatAmount,
  mapStatusCode,
  notificationSchema,
  parseAmount,
  PAYHERE_CURRENCY,
  PAYHERE_PROVIDER,
  payhereApi,
  PayHereApiError,
  payhereSetup,
  signedNotification,
  storableFields,
  verifyNotification,
  type PayHereApi,
  type PayHereNotification,
  type RemotePayment,
} from "../payments/payhere";
import { assertRole, type Actor } from "../permissions";
import { findShopById } from "../repositories/catalogue";
import {
  findOrderById,
  findOrderByNumber,
  findSellerOrder,
  partiesOfSellerOrders,
  updateSellerOrder,
} from "../repositories/commerce";
import {
  addRefundedCents,
  cancelledPaidSellerOrdersWithoutRefund,
  chargedBackPayments,
  deliveredPaidSellerOrders,
  findPayment,
  findRefund,
  flagPaymentForRefund,
  heldShops,
  holdShopPayouts,
  insertPaymentOnce,
  insertRefund,
  liveRefundCentsOfPayment,
  liveRefundOf,
  lockPayment,
  lockPaymentById,
  lockSellerOrder,
  markOrderPaid,
  openPaidSellerOrders,
  ordersToReconcile,
  paymentsAwaitingRefund,
  paymentsOfOrder,
  paymentsOfOrders,
  recentRefunds,
  releaseShopPayoutHold,
  setOrderRefundStatus,
  settleRefund,
  settlingPaymentOfOrder,
  updatePaymentStatus,
} from "../repositories/payments";
import {
  addNotification,
  addNotifications,
  findUserById,
  latestAuditEntry,
  listAdminIds,
  newId,
} from "../repositories/people";
import { countEvent } from "./ops";
import { commissionFor } from "./payouts";
import { audit, JOB_BATCH_SIZE, WORKER } from "./shared";

// B08: PayHere payments (backend plan 9.1 steps 5 to 7, 9.2). The notify route and the dev simulator both call
// receivePayHereNotification; it is the only code that marks an order paid (BR-09).

const DAY_MS = 86_400_000;

// ---------- Notifications (PAY-03 to PAY-06) ----------

export type NotificationOutcome =
  | { result: "rejected"; reason: "invalid" | "merchant" | "signature" | "unknown_order" | "amount" | "currency" }
  | { result: "unknown_status"; statusCode: string }
  | { result: "duplicate" }
  | { result: "ignored"; from: ProviderPaymentStatus; to: ProviderPaymentStatus }
  | { result: "recorded"; status: ProviderPaymentStatus }
  | { result: "paid"; orderNumber: string }
  | { result: "late"; orderNumber: string }
  | { result: "chargeback"; orderNumber: string; heldShops: number };

/** PAY-04: the moves a payment's status may make; anything else (e.g. "pending" after "success") is ignored. */
const PAYMENT_FLOW: Partial<Record<ProviderPaymentStatus, readonly ProviderPaymentStatus[]>> = {
  PENDING: ["SUCCESS", "FAILED", "CANCELLED"],
  SUCCESS: ["CHARGEDBACK"],
};

/**
 * PAY-03: one notification from PayHere (or the dev simulator), as the form fields it posted. Checks the fields
 * (zod), the merchant and the signature (constant time), the order, the amount and the currency; any mismatch is
 * logged as a security event and nothing changes. Never throws for a bad notification: PayHere gets 200 either way,
 * and only a database failure throws (so PayHere may retry).
 */
export async function receivePayHereNotification(
  fields: Record<string, unknown>,
  log: Logger,
  now = new Date(),
  env: Env = getEnv(),
): Promise<NotificationOutcome> {
  const parsed = notificationSchema.safeParse(fields);
  if (!parsed.success) {
    log.warn(
      { event: "security.payment_notification", reason: "invalid", fields: parsed.error.issues.map((i) => i.path[0]) },
      "payment.notification_rejected",
    );
    await countEvent("payment_signature_failed", now); // B12 (OPS-06)
    return { result: "rejected", reason: "invalid" };
  }
  const notification = parsed.data;
  const context = { orderNumber: notification.order_id, paymentId: notification.payment_id };
  const verified = verifyNotification(notification, env);
  if (!verified.ok) {
    log.warn(
      { event: "security.payment_notification", reason: verified.reason, ...context },
      "payment.notification_rejected",
    );
    await countEvent("payment_signature_failed", now);
    return { result: "rejected", reason: verified.reason };
  }
  const outcome = await withTx((tx) => applyNotification(tx, notification, log, now));
  const level = outcome.result === "rejected" ? "warn" : "info";
  log[level](
    {
      ...context,
      ...(outcome.result === "rejected" && { event: "security.payment_notification" }),
      outcome,
      statusCode: notification.status_code,
      method: notification.method,
    },
    `payment.notification_${outcome.result}`,
  );
  return outcome;
}

async function applyNotification(tx: Tx, n: PayHereNotification, log: Logger, now: Date): Promise<NotificationOutcome> {
  const status = mapStatusCode(n.status_code);
  if (!status) return { result: "unknown_status", statusCode: n.status_code };
  const found = await findOrderByNumber(tx, n.order_id);
  if (!found) return { result: "rejected", reason: "unknown_order" };
  const { order } = found;
  // PAY-03: the amount and currency must be exactly what the order costs (integer cents, no float rounding).
  if (n.payhere_currency !== PAYHERE_CURRENCY) return { result: "rejected", reason: "currency" };
  const amountCents = parseAmount(n.payhere_amount);
  if (amountCents !== order.totalCents) return { result: "rejected", reason: "amount" };

  const raw = storableFields(n);
  const statusCode = Number(n.status_code);
  const created = await insertPaymentOnce(
    tx,
    {
      id: newId("pay"),
      orderId: order.id,
      provider: PAYHERE_PROVIDER,
      providerPaymentId: n.payment_id,
      amountCents,
      currency: n.payhere_currency,
      status,
      statusCode,
      method: n.method,
      refundedCents: 0,
      verifiedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    raw,
  );
  // The row exists now (ours, or a concurrent duplicate's after it committed); lock it so its status moves once.
  let payment = (await lockPayment(tx, PAYHERE_PROVIDER, n.payment_id))!;
  if (payment.orderId !== order.id) return { result: "rejected", reason: "unknown_order" };
  if (!created) {
    if (payment.status === status) return { result: "duplicate" };
    if (!PAYMENT_FLOW[payment.status]?.includes(status)) return { result: "ignored", from: payment.status, to: status };
    const moved = await updatePaymentStatus(tx, payment.id, payment.status, { status, statusCode, raw, now });
    if (!moved) return { result: "duplicate" };
    payment = moved;
  }

  if (status === "SUCCESS") return paymentSucceeded(tx, order, payment, log, now);
  if (status === "CHARGEDBACK") return paymentChargedBack(tx, order, payment, log, now);
  return { result: "recorded", status };
}

/**
 * PAY-04 / PAY-06: the order moves PENDING → PAID only while it is still PENDING (a few seconds past expires_at is
 * fine: the stock is still held until orders.expireUnpaid runs). If the expiry job, or another payment, got there
 * first, the money is flagged for an admin refund and the order is never re-opened.
 */
async function paymentSucceeded(
  tx: Tx,
  order: Order,
  payment: Payment,
  log: Logger,
  now: Date,
): Promise<NotificationOutcome> {
  const paid = await markOrderPaid(tx, order.id, now);
  if (!paid) {
    const current = await findOrderById(tx, order.id);
    const reason =
      current?.paymentStatus === "EXPIRED"
        ? `Paid after the order expired (not paid within ${PAYMENT_WINDOW_MINUTES} minutes)`
        : `The order was already paid by another payment`;
    await flagPaymentForRefund(tx, payment.id, reason, now);
    await tellAdmins(tx, "payment.needs_refund", `Payment for ${order.orderNumber} needs a refund: ${reason}`);
    await addNotification(
      tx,
      order.customerId,
      "payment.late",
      `We received your payment for ${order.orderNumber} after the order closed. It will be refunded in full.`,
      `/account/orders/${order.orderNumber}`,
    );
    log.warn({ orderNumber: order.orderNumber, paymentId: payment.providerPaymentId, reason }, "payment.late");
    return { result: "late", orderNumber: order.orderNumber };
  }
  const deadline = new Date(now.getTime() + SELLER_ACCEPT_DEADLINE_DAYS * DAY_MS);
  const opened = await openPaidSellerOrders(tx, order.id, deadline, now);
  // One query for every maker to tell (no query per seller order).
  const parties = await partiesOfSellerOrders(
    tx,
    opened.map((so) => so.id),
  );
  await addNotifications(tx, [
    {
      userId: order.customerId,
      type: "order.paid",
      title: `Payment received for ${order.orderNumber}. The maker has ${SELLER_ACCEPT_DEADLINE_DAYS} days to accept it.`,
      href: `/account/orders/${order.orderNumber}`,
    },
    ...opened.map((so) => ({
      userId: parties.get(so.id)!.shopOwnerId,
      type: "order.new",
      title: `New paid order ${order.orderNumber}: please accept it within ${SELLER_ACCEPT_DEADLINE_DAYS} days`,
      href: `/seller/orders/${so.id}`,
    })),
  ]);
  // B10: the customer's receipt and each maker's "new paid order". Queueing never throws, so a payment PayHere
  // confirmed is always recorded, email or not.
  await queueEmail(tx, "order.placed", {
    userId: order.customerId,
    key: order.id,
    data: {
      orderNumber: order.orderNumber,
      totalCents: order.totalCents,
      shopNames: [...new Set(opened.map((so) => parties.get(so.id)!.shopName))],
    },
  });
  for (const so of opened)
    await queueEmail(tx, "order.new", {
      userId: parties.get(so.id)!.shopOwnerId,
      key: so.id,
      data: {
        orderNumber: order.orderNumber,
        sellerOrderId: so.id,
        subtotalCents: so.subtotalCents,
        acceptDays: SELLER_ACCEPT_DEADLINE_DAYS,
      },
    });
  return { result: "paid", orderNumber: order.orderNumber };
}

/** PAY-05: a chargeback holds the payouts of the order's shops and alerts admins at once. */
async function paymentChargedBack(
  tx: Tx,
  order: Order,
  payment: Payment,
  log: Logger,
  now: Date,
): Promise<NotificationOutcome> {
  const found = await findOrderByNumber(tx, order.orderNumber);
  const shopIds = [...new Set(found?.sellerOrders.map((s) => s.sellerOrder.shopId) ?? [])];
  // Money flagged as unusable (PAY-06) never reached a shop, so there is nothing to hold for it.
  const reason = `Chargeback on ${order.orderNumber} (PayHere payment ${payment.providerPaymentId})`;
  const held = payment.needsRefundReason ? [] : await holdShopPayouts(tx, shopIds, reason, now);
  for (const shopId of held) {
    await audit(tx, WORKER, "shop.payout_held", "SHOP", shopId, {
      reason: `PayHere chargeback notification for ${order.orderNumber}`,
      after: { payoutHoldReason: reason },
    });
  }
  await tellAdmins(tx, "payment.chargeback", `Chargeback on ${order.orderNumber}: payouts held for review`);
  log.error(
    { orderNumber: order.orderNumber, paymentId: payment.providerPaymentId, heldShops: held.length },
    "payment.chargeback",
  );
  return { result: "chargeback", orderNumber: order.orderNumber, heldShops: held.length };
}

async function tellAdmins(tx: Tx, type: string, title: string): Promise<void> {
  const adminIds = await listAdminIds(tx);
  await addNotifications(
    tx,
    adminIds.map((userId) => ({ userId, type, title, href: "/admin/payments" })),
  );
}

// ---------- Pay page and result page (backend plan 9.1 steps 5 and 7) ----------

export type PayPage =
  | { state: "pay"; order: Order; form: ReturnType<typeof checkoutForm>; standIn: boolean; lastFailure?: Payment }
  | { state: "done"; order: Order };

/**
 * The PayHere form for the customer's own unpaid order, built on the server with the merchant secret (PAY-02).
 * Anyone else's order looks missing (SEC-A5). A paid or expired order has nothing to pay.
 */
export async function payPageFor(actor: Actor, orderNumber: string, now = new Date(), env: Env = getEnv()) {
  const found = await findOrderByNumber(db, orderNumber);
  if (!found || found.order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  const { order, sellerOrders } = found;
  const open = order.paymentStatus === "PENDING" && (!order.expiresAt || Date.parse(order.expiresAt) > now.getTime());
  if (!open) return { state: "done", order } satisfies PayPage;
  const user = await findUserById(db, actor.id);
  const address = order.shippingAddress;
  const [firstName, ...rest] = address.recipientName.trim().split(/\s+/);
  const items = sellerOrders.flatMap((s) => s.items);
  const form = checkoutForm(
    {
      orderNumber: order.orderNumber,
      amountCents: order.totalCents,
      items: items.length === 1 ? items[0]!.productTitle.slice(0, 100) : `CeyLiving order ${order.orderNumber}`,
      customer: {
        firstName: firstName ?? "Customer",
        lastName: rest.join(" ") || firstName || "Customer",
        email: user?.email ?? "",
        phone: address.phone,
        address: [address.line1, address.line2].filter(Boolean).join(", "),
        city: address.city,
      },
      returnUrl: `${env.SITE_URL}/checkout/result?order=${encodeURIComponent(order.orderNumber)}`,
      cancelUrl: `${env.SITE_URL}/checkout/pay/${encodeURIComponent(order.orderNumber)}`,
    },
    env,
  );
  const [latest] = await paymentsOfOrder(db, order.id);
  const lastFailure = latest && ["FAILED", "CANCELLED"].includes(latest.status) ? latest : undefined;
  return { state: "pay", order, form, standIn: payhereSetup(env).standIn, lastFailure } satisfies PayPage;
}

export type PaymentResult = "paid" | "failed" | "cancelled" | "waiting" | "expired" | "refunded";

/** BR-09: what the result page shows, read from the database only. The browser's return never changes anything. */
export async function paymentResultFor(actor: Actor, orderNumber: string, now = new Date()) {
  const found = await findOrderByNumber(db, orderNumber);
  if (!found || found.order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  const { order } = found;
  const [latest] = await paymentsOfOrder(db, order.id);
  const canRetry =
    order.paymentStatus === "PENDING" && !!order.expiresAt && Date.parse(order.expiresAt) > now.getTime();
  const result: PaymentResult =
    order.paymentStatus === "PAID"
      ? "paid"
      : order.paymentStatus === "EXPIRED"
        ? "expired"
        : order.paymentStatus !== "PENDING"
          ? "refunded"
          : latest?.status === "FAILED"
            ? "failed"
            : latest?.status === "CANCELLED"
              ? "cancelled"
              : "waiting";
  return { order, result, canRetry, latePayment: Boolean(latest?.needsRefundReason) };
}

export type SimulatedOutcome = "success" | "failed" | "cancelled";

/**
 * Development only (backend plan 15, "Simulate payment"): what PayHere would post for the customer's own order,
 * correctly signed, through the same receivePayHereNotification as the notify route. Refused in production.
 */
export async function simulatePayment(
  actor: Actor,
  orderNumber: string,
  outcome: SimulatedOutcome,
  log: Logger,
  now = new Date(),
  env: Env = getEnv(),
): Promise<NotificationOutcome> {
  if (env.NODE_ENV === "production") throw new NotFoundError("Not found.");
  const found = await findOrderByNumber(db, orderNumber);
  if (!found || found.order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  const fields = signedNotification(
    {
      order_id: found.order.orderNumber,
      payment_id: `SIM-${crypto.randomUUID()}`,
      payhere_amount: formatAmount(found.order.totalCents),
      payhere_currency: PAYHERE_CURRENCY,
      status_code: { success: "2", failed: "-2", cancelled: "-1" }[outcome],
      status_message: `Simulated ${outcome} (development only)`,
      method: "TEST",
    },
    env,
  );
  return receivePayHereNotification(fields, log.child({ simulated: true }), now, env);
}

// ---------- Refunds (PAY-07, BR-18) ----------

export interface RefundRequest {
  method: RefundMethod;
  reason: string;
  /** MANUAL: the bank transfer's reference. */
  reference?: string;
}

/** Seller order statuses a refund can be issued for, and what each becomes (BR-07: COMPLETED → REFUNDED, admin). */
const REFUNDABLE: Partial<Record<SellerOrder["status"], SellerOrder["status"]>> = {
  CANCELLED: "CANCELLED",
  DISPATCHED: "REFUNDED",
  COMPLETED: "REFUNDED",
};

/**
 * BR-18: an admin refunds one paid seller order in full (its items and delivery). Refused for a seller order that
 * is still open (cancel it first), or one already refunded (a live refund exists; the database's partial unique
 * index backs this up against two admins at once).
 */
export async function refundSellerOrder(
  actor: Actor,
  sellerOrderId: string,
  request: RefundRequest,
  now = new Date(),
  api: PayHereApi | undefined = payhereApi(),
): Promise<Refund> {
  assertRole(actor, ["ADMIN"]);
  checkRequest(request, api);
  const refund = await withTx(async (tx) => {
    const so = await lockSellerOrder(tx, sellerOrderId);
    if (!so) throw new NotFoundError("Order not found.");
    if (!REFUNDABLE[so.status]) {
      throw new ConflictError("Only cancelled, dispatched or delivered orders can be refunded. Cancel it first.");
    }
    if (await liveRefundOf(tx, { sellerOrderId: so.id })) throw new ConflictError("This order is already refunded.");
    const settling = await settlingPaymentOfOrder(tx, so.orderId);
    if (!settling)
      throw new ConflictError("No PayHere payment is recorded for this order, so it can’t be refunded here.");
    const payment = (await lockPaymentById(tx, settling.id))!;
    const amountCents = so.subtotalCents + so.shippingCents;
    // The seller gives back their share only if they were already paid for it; otherwise it never reaches a payout.
    const clawbackCents = so.payoutId ? amountCents - commissionFor(so) : 0;
    return startRefund(tx, actor, payment, { sellerOrderId: so.id, amountCents, clawbackCents }, request, now);
  });
  return finishRefund(actor, refund, request, now, api);
}

/** PAY-06: an admin refunds a whole payment that couldn't be used (it arrived after expiry, or paid twice). */
export async function refundUnusablePayment(
  actor: Actor,
  paymentId: string,
  request: RefundRequest,
  now = new Date(),
  api: PayHereApi | undefined = payhereApi(),
): Promise<Refund> {
  assertRole(actor, ["ADMIN"]);
  checkRequest(request, api);
  const refund = await withTx(async (tx) => {
    const payment = await lockPaymentById(tx, paymentId);
    if (!payment) throw new NotFoundError("Payment not found.");
    if (!payment.needsRefundReason) {
      throw new ConflictError("This payment paid its order. Refund the order’s items from the shop’s order instead.");
    }
    if (await liveRefundOf(tx, { paymentId })) throw new ConflictError("This payment is already refunded.");
    return startRefund(tx, actor, payment, { amountCents: payment.amountCents, clawbackCents: 0 }, request, now);
  });
  return finishRefund(actor, refund, request, now, api);
}

function checkRequest(request: RefundRequest, api: PayHereApi | undefined) {
  if (request.method === "MANUAL" && !request.reference) {
    throw new ValidationError("Enter the bank transfer reference.", { reference: "Required for a manual refund" });
  }
  if (request.method === "PAYHERE" && !api) {
    throw new ConflictError("Refunds through PayHere aren’t set up (PAYHERE_APP_ID). Record a manual refund instead.");
  }
}

async function startRefund(
  tx: Tx,
  actor: Actor,
  payment: Payment,
  target: { sellerOrderId?: string; amountCents: number; clawbackCents: number },
  request: RefundRequest,
  now: Date,
): Promise<Refund> {
  if (payment.status === "CHARGEDBACK") {
    throw new ConflictError("This payment was charged back: the bank already returned the money.");
  }
  const promised = await liveRefundCentsOfPayment(tx, payment.id);
  if (promised + target.amountCents > payment.amountCents) {
    throw new ConflictError("That would refund more than was paid.");
  }
  const refund = await insertRefund(tx, {
    id: newId("refund"),
    paymentId: payment.id,
    sellerOrderId: target.sellerOrderId,
    amountCents: target.amountCents,
    clawbackCents: target.clawbackCents,
    reason: request.reason,
    method: request.method,
    status: "PENDING",
    createdById: actor.id,
    createdAt: now.toISOString(),
  });
  if (request.method === "MANUAL") {
    return completeRefund(tx, actor, refund, request.reference!, now);
  }
  return refund;
}

/**
 * PAYHERE refunds call PayHere between two transactions (never inside one). A refusal marks the refund FAILED (it
 * can be tried again); no answer leaves it PENDING, because PayHere's refund API has no idempotency key and a blind
 * retry could refund twice: the admin checks PayHere and records the outcome (resolvePendingRefund).
 */
async function finishRefund(
  actor: Actor,
  refund: Refund,
  request: RefundRequest,
  now: Date,
  api: PayHereApi | undefined,
): Promise<Refund> {
  if (refund.status !== "PENDING" || request.method !== "PAYHERE") return refund;
  const payment = (await findPayment(db, refund.paymentId))!;
  try {
    const { refundRef } = await api!.refund({
      paymentId: payment.providerPaymentId,
      amountCents: refund.amountCents < payment.amountCents ? refund.amountCents : undefined,
      description: request.reason.slice(0, 100),
    });
    return withTx((tx) => completeRefund(tx, actor, refund, refundRef, now));
  } catch (error) {
    if (error instanceof PayHereApiError && error.kind === "refused") {
      await withTx((tx) => failRefund(tx, actor, refund, error.message, now));
      throw new ConflictError(error.message);
    }
    if (error instanceof PayHereApiError) {
      throw new ConflictError(
        "PayHere didn’t confirm the refund. It stays pending: check the payment in PayHere, then record what happened.",
      );
    }
    throw error;
  }
}

async function completeRefund(tx: Tx, actor: Actor, refund: Refund, reference: string, now: Date): Promise<Refund> {
  const settled = await settleRefund(tx, refund.id, { status: "SUCCEEDED", providerRef: reference, now });
  if (!settled) throw new ConflictError("This refund was just settled elsewhere. Reload the page.");
  const payment = await addRefundedCents(tx, refund.paymentId, refund.amountCents, now);
  const order = (await findOrderById(tx, payment.orderId))!;
  let shopOwnerId: string | undefined;
  let sellerOrderBefore: SellerOrder | undefined;
  if (refund.sellerOrderId) {
    // A seller order's refund comes out of the payment that paid the order: the order is (partly) refunded.
    await setOrderRefundStatus(
      tx,
      order.id,
      payment.refundedCents >= payment.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED",
    );
    sellerOrderBefore = await findSellerOrder(tx, refund.sellerOrderId);
    const to = sellerOrderBefore && REFUNDABLE[sellerOrderBefore.status];
    if (sellerOrderBefore && to && to !== sellerOrderBefore.status) {
      const moved = await updateSellerOrder(
        tx,
        sellerOrderBefore.id,
        { status: to, updatedAt: now.toISOString() },
        { from: sellerOrderBefore.status },
      );
      if (!moved) throw new ConflictError("This order was just changed elsewhere. Reload the page and try again.");
    }
    shopOwnerId = sellerOrderBefore && (await findShopById(tx, sellerOrderBefore.shopId))?.ownerId;
  }
  await addNotifications(tx, [
    {
      userId: order.customerId,
      type: "refund.issued",
      title: `A refund of ${formatLkr(refund.amountCents)} for ${order.orderNumber} is on its way`,
      href: `/account/orders/${order.orderNumber}`,
    },
    ...(shopOwnerId && refund.sellerOrderId
      ? [
          {
            userId: shopOwnerId,
            type: "refund.issued",
            title:
              refund.clawbackCents > 0
                ? `${order.orderNumber} was refunded; ${formatLkr(refund.clawbackCents)} comes off your next payout`
                : `${order.orderNumber} was refunded to the customer`,
            href: `/seller/orders/${refund.sellerOrderId}`,
          },
        ]
      : []),
  ]);
  await audit(tx, actor, "refund.issued", "REFUND", refund.id, {
    reason: refund.reason,
    before: sellerOrderBefore ? { sellerOrderStatus: sellerOrderBefore.status } : undefined,
    after: {
      orderNumber: order.orderNumber,
      sellerOrderId: refund.sellerOrderId,
      amountCents: refund.amountCents,
      clawbackCents: refund.clawbackCents,
      method: refund.method,
      reference,
    },
  });
  return settled;
}

async function failRefund(tx: Tx, actor: Actor, refund: Refund, failure: string, now: Date): Promise<void> {
  const failed = await settleRefund(tx, refund.id, { status: "FAILED", failure, now });
  if (failed) await audit(tx, actor, "refund.failed", "REFUND", refund.id, { reason: failure });
}

/** A PayHere refund left PENDING (no answer): the admin checked PayHere and records what happened. */
export async function resolvePendingRefund(
  actor: Actor,
  refundId: string,
  outcome: { succeeded: true; reference: string } | { succeeded: false; note: string },
  now = new Date(),
): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const refund = await findRefund(tx, refundId);
    if (!refund) throw new NotFoundError("Refund not found.");
    if (refund.status !== "PENDING") throw new ConflictError("This refund is already settled.");
    if (outcome.succeeded) await completeRefund(tx, actor, refund, outcome.reference, now);
    else await failRefund(tx, actor, refund, `Checked in PayHere: ${outcome.note}`, now);
  });
}

// ---------- Chargeback payout hold (PAY-05) ----------

/** An admin reviewed a chargeback and releases the shop's payouts; who, when and why go in the audit log. */
export async function releasePayoutHold(actor: Actor, shopId: string, reason: string): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const released = await releaseShopPayoutHold(tx, shopId);
    if (!released) throw new ConflictError("This shop’s payouts aren’t held (someone may have released them).");
    await audit(tx, actor, "shop.payout_released", "SHOP", shopId, {
      reason,
      before: { payoutHoldReason: released.reason, payoutHeldAt: released.heldAt },
      after: { payoutHoldReason: null },
    });
  });
}

// ---------- Admin overview ----------

const ADMIN_LIST_LIMIT = 50;

export async function adminPaymentsOverview(actor: Actor) {
  assertRole(actor, ["ADMIN"]);
  const [cancelledToRefund, latePayments, refunds, chargebacks, held, lastReconciliation, delivered] =
    await Promise.all([
      cancelledPaidSellerOrdersWithoutRefund(db, ADMIN_LIST_LIMIT),
      paymentsAwaitingRefund(db, ADMIN_LIST_LIMIT),
      recentRefunds(db, ADMIN_LIST_LIMIT),
      chargedBackPayments(db, ADMIN_LIST_LIMIT),
      heldShops(db),
      latestAuditEntry(db, "payments.reconciled"),
      deliveredPaidSellerOrders(db, ADMIN_LIST_LIMIT),
    ]);
  return {
    cancelledToRefund,
    latePayments,
    refunds,
    chargebacks,
    held,
    lastReconciliation,
    delivered,
    canRefundThroughPayHere: payhereSetup().hasApi,
  };
}

// ---------- Reconciliation (PAY-08) ----------

export type Difference =
  | { kind: "paid_here_not_at_payhere"; orderNumber: string }
  | { kind: "missing_notification"; orderNumber: string; paymentId: string }
  | { kind: "amount_mismatch"; orderNumber: string; paymentId: string; ours: number; payhere?: number }
  | { kind: "status_mismatch"; orderNumber: string; paymentId: string; ours: string; payhere: string }
  | { kind: "unchecked"; orderNumber: string; error: string };

const COLOMBO_OFFSET_MS = 5.5 * 3_600_000; // Asia/Colombo is UTC+05:30 all year

/** The previous calendar day in Colombo, as [from, to) instants. */
export function previousColomboDay(now: Date): { from: Date; to: Date; label: string } {
  const localMidnight = Math.floor((now.getTime() + COLOMBO_OFFSET_MS) / DAY_MS) * DAY_MS;
  const to = new Date(localMidnight - COLOMBO_OFFSET_MS);
  const from = new Date(to.getTime() - DAY_MS);
  return { from, to, label: new Date(localMidnight - DAY_MS).toISOString().slice(0, 10) };
}

const PAID_AT_PAYHERE = new Set(["RECEIVED", "REFUND REQUESTED", "REFUND PROCESSING", "REFUNDED", "CHARGEBACKED"]);

/** One order compared with PayHere's records of it. Pure, so each case is tested on its own. */
export function compareWithPayHere(order: Order, ours: Payment[], theirs: RemotePayment[]): Difference[] {
  const differences: Difference[] = [];
  const orderNumber = order.orderNumber;
  const paidHere = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus);
  const theirsPaid = theirs.filter((p) => PAID_AT_PAYHERE.has(p.status));
  if (paidHere && !theirsPaid.length) differences.push({ kind: "paid_here_not_at_payhere", orderNumber });
  for (const remote of theirsPaid) {
    const local = ours.find((p) => p.providerPaymentId === remote.paymentId);
    if (!local || local.status === "PENDING" || local.status === "FAILED" || local.status === "CANCELLED") {
      differences.push({ kind: "missing_notification", orderNumber, paymentId: remote.paymentId });
      continue;
    }
    if (remote.amountCents !== local.amountCents) {
      differences.push({
        kind: "amount_mismatch",
        orderNumber,
        paymentId: remote.paymentId,
        ours: local.amountCents,
        payhere: remote.amountCents,
      });
    }
    const theirsChargedBack = remote.status === "CHARGEBACKED";
    const theirsRefunded = remote.status === "REFUNDED";
    if (theirsChargedBack !== (local.status === "CHARGEDBACK") || (theirsRefunded && local.refundedCents === 0)) {
      differences.push({
        kind: "status_mismatch",
        orderNumber,
        paymentId: remote.paymentId,
        ours: local.refundedCents ? `${local.status} (refunded ${local.refundedCents})` : local.status,
        payhere: remote.status,
      });
    }
  }
  return differences;
}

/**
 * PAY-08 (payments.reconcile, daily 02:00): compares the previous Colombo day's orders with PayHere's records and
 * reports differences to admins. It never changes an order or a payment: a person decides (JOB-03: a rerun only
 * repeats the report). Skipped when the Merchant API isn't configured.
 */
export async function reconcilePayments(
  log: Logger,
  now = new Date(),
  api: PayHereApi | undefined = payhereApi(),
): Promise<{ skipped: true } | { day: string; checked: number; differences: Difference[] }> {
  if (!api) {
    log.info("payments.reconcile skipped: PAYHERE_APP_ID / PAYHERE_APP_SECRET aren't set");
    return { skipped: true };
  }
  const { from, to, label } = previousColomboDay(now);
  const differences: Difference[] = [];
  let checked = 0;
  let after: string | undefined;
  for (;;) {
    const orders = await ordersToReconcile(db, from, to, after, JOB_BATCH_SIZE);
    const payments = await paymentsOfOrders(
      db,
      orders.map((o) => o.id),
    );
    for (const order of orders) {
      let theirs: RemotePayment[];
      try {
        theirs = await api.paymentsOfOrder(order.orderNumber);
      } catch (error) {
        if (!(error instanceof PayHereApiError)) throw error;
        differences.push({ kind: "unchecked", orderNumber: order.orderNumber, error: error.message });
        continue;
      }
      checked++;
      differences.push(
        ...compareWithPayHere(
          order,
          payments.filter((p) => p.orderId === order.id),
          theirs,
        ),
      );
    }
    if (orders.length < JOB_BATCH_SIZE) break;
    after = orders.at(-1)!.id;
  }
  if (checked === 0 && differences.length > 0) {
    throw new Error(`payments.reconcile couldn't reach PayHere for any of ${differences.length} orders; retrying.`);
  }
  for (const difference of differences) log.warn({ day: label, ...difference }, "payment.reconcile_difference");
  await withTx(async (tx) => {
    await audit(tx, WORKER, "payments.reconciled", "PAYMENTS", label, {
      reason: "Daily payment reconciliation (payments.reconcile)",
      after: { checked, differences },
    });
    if (differences.length) {
      await tellAdmins(
        tx,
        "payment.reconcile",
        `Payment check for ${label}: ${differences.length} difference(s) with PayHere need a look`,
      );
    }
  });
  return { day: label, checked, differences };
}
