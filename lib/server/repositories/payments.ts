import "server-only";
import type { Order, Payment, ProviderPaymentStatus, Refund, SellerOrder } from "@/lib/types";
import type { Prisma } from "../db/generated/client";
import { toOrder, toPayment, toRefund, toSellerOrder } from "../db/mappers";
import { clientOf, writableClientOf, type Tx } from "../db/tx";
import { ConflictError } from "../errors";

// B08: payments, refunds, and the order and shop changes a payment causes. The only code that touches these rows
// (BE-01). Every status change is a conditional update (DB-06), so a repeated notification, a racing job or a
// second admin click changes nothing twice.

// ---------- Payments ----------

/**
 * PAY-04: inserts the payment unless (provider, provider_payment_id) already exists (ON CONFLICT DO NOTHING). A
 * concurrent duplicate waits on the unique index until the first commits, then inserts nothing. Returns whether
 * this call inserted it.
 */
export async function insertPaymentOnce(tx: Tx, payment: Payment, raw: Record<string, string>): Promise<boolean> {
  const data = {
    ...payment,
    raw,
    needsRefundReason: payment.needsRefundReason ?? null,
    method: payment.method ?? null,
    verifiedAt: new Date(payment.verifiedAt),
    createdAt: new Date(payment.createdAt),
    updatedAt: new Date(payment.updatedAt),
  } satisfies Prisma.PaymentCreateManyInput;
  const { count } = await writableClientOf(tx).payment.createMany({ data: [data], skipDuplicates: true });
  return count === 1;
}

/** The payment with this provider id, locked until the transaction ends (FOR UPDATE), so its status moves once. */
export async function lockPayment(tx: Tx, provider: string, providerPaymentId: string): Promise<Payment | undefined> {
  const client = writableClientOf(tx);
  const [row] = await client.$queryRaw<{ id: string }[]>`
    SELECT id FROM payments WHERE provider = ${provider} AND provider_payment_id = ${providerPaymentId} FOR UPDATE`;
  if (!row) return undefined;
  return findPayment(tx, row.id);
}

/** A payment by our id, locked (FOR UPDATE) for a refund. */
export async function lockPaymentById(tx: Tx, id: string): Promise<Payment | undefined> {
  const client = writableClientOf(tx);
  const [row] = await client.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
  return row ? findPayment(tx, row.id) : undefined;
}

export async function findPayment(tx: Tx, id: string): Promise<Payment | undefined> {
  const row = await clientOf(tx).payment.findUnique({ where: { id } });
  return row ? toPayment(row) : undefined;
}

/** DB-06: moves a payment from `from` to `to`; undefined if it had already moved. */
export async function updatePaymentStatus(
  tx: Tx,
  id: string,
  from: ProviderPaymentStatus,
  to: { status: ProviderPaymentStatus; statusCode: number; raw: Record<string, string>; now: Date },
): Promise<Payment | undefined> {
  const [row] = await writableClientOf(tx).payment.updateManyAndReturn({
    where: { id, status: from },
    data: { status: to.status, statusCode: to.statusCode, raw: to.raw, verifiedAt: to.now, updatedAt: to.now },
  });
  return row ? toPayment(row) : undefined;
}

/** PAY-06: this money can't go to its order; an admin refunds it. */
export async function flagPaymentForRefund(tx: Tx, id: string, reason: string, now: Date): Promise<void> {
  await writableClientOf(tx).payment.updateMany({
    where: { id, needsRefundReason: null },
    data: { needsRefundReason: reason, updatedAt: now },
  });
}

/** BR-18: adds a settled refund to the payment. The CHECK refunded_cents <= amount_cents stops over-refunding. */
export async function addRefundedCents(tx: Tx, paymentId: string, cents: number, now: Date): Promise<Payment> {
  const row = await writableClientOf(tx).payment.update({
    where: { id: paymentId },
    data: { refundedCents: { increment: cents }, updatedAt: now },
  });
  return toPayment(row);
}

/** An order's payments, newest first. */
export async function paymentsOfOrder(tx: Tx, orderId: string): Promise<Payment[]> {
  const rows = await clientOf(tx).payment.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toPayment);
}

/** The payments of many orders in one query (reconciliation, JOB-06). */
export async function paymentsOfOrders(tx: Tx, orderIds: string[]): Promise<Payment[]> {
  if (!orderIds.length) return [];
  const rows = await clientOf(tx).payment.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: [{ orderId: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toPayment);
}

/** The payment that paid this order: successful and not flagged as unusable (PAY-06). */
export async function settlingPaymentOfOrder(tx: Tx, orderId: string): Promise<Payment | undefined> {
  const row = await clientOf(tx).payment.findFirst({
    where: { orderId, status: { in: ["SUCCESS", "CHARGEDBACK"] }, needsRefundReason: null },
    orderBy: { createdAt: "asc" },
  });
  return row ? toPayment(row) : undefined;
}

/** PAY-06: payments flagged for a refund that have no live (pending or done) whole-payment refund yet. */
export async function paymentsAwaitingRefund(tx: Tx, limit: number): Promise<(Payment & { orderNumber: string })[]> {
  const rows = await clientOf(tx).payment.findMany({
    where: { needsRefundReason: { not: null }, refunds: { none: { sellerOrderId: null, status: { not: "FAILED" } } } },
    include: { order: { select: { orderNumber: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  return rows.map((row) => ({ ...toPayment(row), orderNumber: row.order.orderNumber }));
}

/** Recent chargebacks, for the admin page. */
export async function chargedBackPayments(tx: Tx, limit: number): Promise<(Payment & { orderNumber: string })[]> {
  const rows = await clientOf(tx).payment.findMany({
    where: { status: "CHARGEDBACK" },
    include: { order: { select: { orderNumber: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({ ...toPayment(row), orderNumber: row.order.orderNumber }));
}

// ---------- Orders and seller orders on payment ----------

/**
 * PAY-04 / DB-06: PENDING → PAID, only while still PENDING. orders.expireUnpaid makes the opposite move with the same
 * kind of update, so whichever takes the row lock first wins and the other changes nothing.
 */
export async function markOrderPaid(tx: Tx, orderId: string, now: Date): Promise<Order | undefined> {
  const [row] = await writableClientOf(tx).order.updateManyAndReturn({
    where: { id: orderId, paymentStatus: "PENDING" },
    data: { paymentStatus: "PAID", paidAt: now },
  });
  return row ? toOrder(row) : undefined;
}

/** BR-07: a paid order's seller orders become NEW, with the maker's accept deadline (BR-08). */
export async function openPaidSellerOrders(
  tx: Tx,
  orderId: string,
  acceptDeadlineAt: Date,
  now: Date,
): Promise<SellerOrder[]> {
  const rows = await writableClientOf(tx).sellerOrder.updateManyAndReturn({
    where: { orderId, status: "PENDING_PAYMENT" },
    data: { status: "NEW", acceptDeadlineAt, updatedAt: now },
  });
  return rows.map(toSellerOrder);
}

/** BR-18: an order's payment status after a refund (PAID → PARTIALLY_REFUNDED → REFUNDED). */
export async function setOrderRefundStatus(
  tx: Tx,
  orderId: string,
  status: "PARTIALLY_REFUNDED" | "REFUNDED",
): Promise<void> {
  await writableClientOf(tx).order.updateMany({
    where: { id: orderId, paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
    data: { paymentStatus: status },
  });
}

/**
 * BR-18: paid seller orders that were cancelled (by the maker, the customer, an admin or the accept-deadline job)
 * and have no live refund yet: the admin's "needs refund" queue.
 */
export async function cancelledPaidSellerOrdersWithoutRefund(
  tx: Tx,
  limit: number,
): Promise<(SellerOrder & { orderNumber: string; shopName: string })[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: {
      status: "CANCELLED",
      order: { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
      refunds: { none: { status: { not: "FAILED" } } },
    },
    include: { order: { select: { orderNumber: true } }, shop: { select: { name: true } } },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  return rows.map((row) => ({ ...toSellerOrder(row), orderNumber: row.order.orderNumber, shopName: row.shop.name }));
}

/** BR-18: dispatched or delivered paid seller orders without a refund, newest first (disputes are refunded here). */
export async function deliveredPaidSellerOrders(
  tx: Tx,
  limit: number,
): Promise<(SellerOrder & { orderNumber: string; shopName: string })[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: {
      status: { in: ["DISPATCHED", "COMPLETED"] },
      order: { paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] }, payments: { some: { status: "SUCCESS" } } },
      refunds: { none: { status: { not: "FAILED" } } },
    },
    include: { order: { select: { orderNumber: true } }, shop: { select: { name: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({ ...toSellerOrder(row), orderNumber: row.order.orderNumber, shopName: row.shop.name }));
}

/** A seller order locked until the transaction ends (FOR UPDATE), so two refunds of it run one after the other. */
export async function lockSellerOrder(tx: Tx, id: string): Promise<SellerOrder | undefined> {
  const client = writableClientOf(tx);
  const [row] = await client.$queryRaw<{ id: string }[]>`SELECT id FROM seller_orders WHERE id = ${id} FOR UPDATE`;
  if (!row) return undefined;
  const found = await client.sellerOrder.findUnique({ where: { id: row.id } });
  return found ? toSellerOrder(found) : undefined;
}

// ---------- Refunds ----------

export async function insertRefund(tx: Tx, refund: Refund): Promise<Refund> {
  await writableClientOf(tx).refund.create({
    data: {
      ...refund,
      sellerOrderId: refund.sellerOrderId ?? null,
      providerRef: refund.providerRef ?? null,
      failure: refund.failure ?? null,
      deductedPayoutId: refund.deductedPayoutId ?? null,
      createdAt: new Date(refund.createdAt),
      settledAt: refund.settledAt ? new Date(refund.settledAt) : null,
    },
  });
  return refund;
}

export async function findRefund(tx: Tx, id: string): Promise<Refund | undefined> {
  const row = await clientOf(tx).refund.findUnique({ where: { id } });
  return row ? toRefund(row) : undefined;
}

/** A live (pending or succeeded) refund of this seller order, or of this whole payment when sellerOrderId is null. */
export async function liveRefundOf(
  tx: Tx,
  target: { sellerOrderId: string } | { paymentId: string },
): Promise<Refund | undefined> {
  const where: Prisma.RefundWhereInput =
    "sellerOrderId" in target
      ? { sellerOrderId: target.sellerOrderId, status: { not: "FAILED" } }
      : { paymentId: target.paymentId, sellerOrderId: null, status: { not: "FAILED" } };
  const row = await clientOf(tx).refund.findFirst({ where });
  return row ? toRefund(row) : undefined;
}

/** Live refunds of one payment: what is already promised back, so a new one can't go over the amount paid. */
export async function liveRefundCentsOfPayment(tx: Tx, paymentId: string): Promise<number> {
  const { _sum } = await clientOf(tx).refund.aggregate({
    where: { paymentId, status: { not: "FAILED" } },
    _sum: { amountCents: true },
  });
  return _sum.amountCents ?? 0;
}

/** DB-06: PENDING → SUCCEEDED or FAILED, once. Undefined if it was already settled. */
export async function settleRefund(
  tx: Tx,
  id: string,
  outcome: { status: "SUCCEEDED"; providerRef: string; now: Date } | { status: "FAILED"; failure: string; now: Date },
): Promise<Refund | undefined> {
  const [row] = await writableClientOf(tx).refund.updateManyAndReturn({
    where: { id, status: "PENDING" },
    data:
      outcome.status === "SUCCEEDED"
        ? { status: "SUCCEEDED", providerRef: outcome.providerRef, settledAt: outcome.now }
        : { status: "FAILED", failure: outcome.failure.slice(0, 500), settledAt: outcome.now },
  });
  return row ? toRefund(row) : undefined;
}

/** Recent refunds with what the admin page shows next to them. */
export async function recentRefunds(
  tx: Tx,
  limit: number,
): Promise<(Refund & { orderNumber: string; providerPaymentId: string; shopName?: string })[]> {
  const rows = await clientOf(tx).refund.findMany({
    include: {
      payment: { select: { providerPaymentId: true, order: { select: { orderNumber: true } } } },
      sellerOrder: { select: { shop: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((row) => ({
    ...toRefund(row),
    orderNumber: row.payment.order.orderNumber,
    providerPaymentId: row.payment.providerPaymentId,
    shopName: row.sellerOrder?.shop.name,
  }));
}

/** BR-18: a shop's settled refunds whose clawback hasn't been taken from a payout yet, oldest first. */
export async function undeductedClawbacksOfShop(tx: Tx, shopId: string): Promise<Refund[]> {
  const rows = await clientOf(tx).refund.findMany({
    where: { status: "SUCCEEDED", clawbackCents: { gt: 0 }, deductedPayoutId: null, sellerOrder: { shopId } },
    orderBy: [{ settledAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toRefund);
}

/** BR-18 / DB-06: links clawbacks to the payout that takes them; throws if another payout took any first. */
export async function markClawbacksDeducted(tx: Tx, refundIds: string[], payoutId: string): Promise<void> {
  if (!refundIds.length) return;
  const { count } = await writableClientOf(tx).refund.updateMany({
    where: { id: { in: refundIds }, deductedPayoutId: null },
    data: { deductedPayoutId: payoutId },
  });
  if (count !== refundIds.length) throw new ConflictError("These refunds were just taken by another payout run.");
}

// ---------- Shops: chargeback payout hold (PAY-05) ----------

/** Holds the payouts of these shops (those not already held). Returns the shops this call held. */
export async function holdShopPayouts(tx: Tx, shopIds: string[], reason: string, now: Date): Promise<string[]> {
  const rows = await writableClientOf(tx).shop.updateManyAndReturn({
    where: { id: { in: shopIds }, payoutHoldReason: null },
    data: { payoutHoldReason: reason, payoutHeldAt: now },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Releases a shop's payout hold; undefined if it wasn't held (someone released it first). */
export async function releaseShopPayoutHold(
  tx: Tx,
  shopId: string,
): Promise<{ reason: string; heldAt: string } | undefined> {
  const client = writableClientOf(tx);
  const before = await client.shop.findUnique({
    where: { id: shopId },
    select: { payoutHoldReason: true, payoutHeldAt: true },
  });
  if (!before?.payoutHoldReason || !before.payoutHeldAt) return undefined;
  const { count } = await client.shop.updateMany({
    where: { id: shopId, payoutHoldReason: { not: null } },
    data: { payoutHoldReason: null, payoutHeldAt: null },
  });
  return count ? { reason: before.payoutHoldReason, heldAt: before.payoutHeldAt.toISOString() } : undefined;
}

export async function heldShops(tx: Tx): Promise<{ id: string; name: string; reason: string; heldAt: string }[]> {
  const rows = await clientOf(tx).shop.findMany({
    where: { payoutHoldReason: { not: null } },
    select: { id: true, name: true, payoutHoldReason: true, payoutHeldAt: true },
    orderBy: [{ payoutHeldAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    reason: row.payoutHoldReason ?? "",
    heldAt: row.payoutHeldAt?.toISOString() ?? "",
  }));
}

// ---------- Reconciliation (PAY-08) ----------

/**
 * Orders placed or paid in [from, to), after `afterId` (keyset paging, JOB-06): the ones reconciliation checks with
 * PayHere. Expired and pending ones are included, so a payment PayHere took but never told us about shows up.
 */
export async function ordersToReconcile(
  tx: Tx,
  from: Date,
  to: Date,
  afterId: string | undefined,
  limit: number,
): Promise<Order[]> {
  const rows = await clientOf(tx).order.findMany({
    where: {
      OR: [{ placedAt: { gte: from, lt: to } }, { paidAt: { gte: from, lt: to } }],
      ...(afterId && { id: { gt: afterId } }),
    },
    orderBy: { id: "asc" },
    take: limit,
  });
  return rows.map(toOrder);
}
