import "server-only";
import type { CustomRequest, Order, OrderItem, Payout, SellerOrder, SellerOrderStatus } from "@/lib/types";
import type { Prisma } from "../db/generated/client";
import {
  clearing,
  customRequestColumns,
  orderColumns,
  payoutColumns,
  payoutInclude,
  sellerOrderColumns,
  toCustomRequest,
  toOrder,
  toOrderItem,
  toPayout,
  toSellerOrder,
} from "../db/mappers";
import { clientOf, writableClientOf, type Tx } from "../db/tx";
import { ConflictError } from "../errors";

// Orders, seller orders, order items, payouts and custom requests. The only code that touches these rows (BE-01).

export interface OrderWithParts {
  order: Order;
  sellerOrders: { sellerOrder: SellerOrder; items: OrderItem[] }[];
}

/** An order with its seller orders and their items, loaded in one query (no query per seller order). */
const orderParts = {
  sellerOrders: { orderBy: { id: "asc" }, include: { items: { orderBy: { id: "asc" } } } },
} as const satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderParts }>;

const assemble = (row: OrderRow): OrderWithParts => ({
  order: toOrder(row),
  sellerOrders: row.sellerOrders.map((so) => ({ sellerOrder: toSellerOrder(so), items: so.items.map(toOrderItem) })),
});

// ---------- Orders ----------

export async function ordersOfCustomer(tx: Tx, customerId: string): Promise<OrderWithParts[]> {
  const rows = await clientOf(tx).order.findMany({
    where: { customerId },
    include: orderParts,
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(assemble);
}

export async function listOrdersOfCustomer(tx: Tx, customerId: string): Promise<Order[]> {
  const rows = await clientOf(tx).order.findMany({
    where: { customerId },
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toOrder);
}

export async function findOrderByNumber(tx: Tx, orderNumber: string): Promise<OrderWithParts | undefined> {
  const row = await clientOf(tx).order.findUnique({ where: { orderNumber }, include: orderParts });
  return row ? assemble(row) : undefined;
}

export async function findOrderById(tx: Tx, id: string): Promise<Order | undefined> {
  const row = await clientOf(tx).order.findUnique({ where: { id } });
  return row ? toOrder(row) : undefined;
}

export async function updateOrder(tx: Tx, id: string, patch: Partial<Order>): Promise<void> {
  const data = clearing(orderColumns(patch)) as Prisma.OrderUncheckedUpdateManyInput;
  await writableClientOf(tx).order.updateMany({ where: { id }, data });
}

// ---------- Seller orders ----------

export async function findSellerOrder(tx: Tx, id: string): Promise<SellerOrder | undefined> {
  const row = await clientOf(tx).sellerOrder.findUnique({ where: { id } });
  return row ? toSellerOrder(row) : undefined;
}

/** SEC-A5: a seller order of this shop only; other shops' orders look missing. */
export async function findSellerOrderForShop(
  tx: Tx,
  sellerOrderId: string,
  shopId: string,
): Promise<SellerOrder | undefined> {
  const row = await clientOf(tx).sellerOrder.findFirst({ where: { id: sellerOrderId, shopId } });
  return row ? toSellerOrder(row) : undefined;
}

export async function sellerOrdersOfShop(tx: Tx, shopId: string): Promise<SellerOrder[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { shopId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toSellerOrder);
}

/** Every seller order belonging to one customer's orders. */
export async function sellerOrdersOfCustomer(tx: Tx, customerId: string): Promise<SellerOrder[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { order: { customerId } },
    orderBy: { id: "asc" },
  });
  return rows.map(toSellerOrder);
}

/** BR-11: delivered seller orders that aren't in any payout yet. */
export async function unpaidCompletedSellerOrders(tx: Tx, shopId?: string): Promise<SellerOrder[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { status: "COMPLETED", payoutId: null, ...(shopId && { shopId }) },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toSellerOrder);
}

export async function orderOfSellerOrder(tx: Tx, sellerOrder: SellerOrder): Promise<Order | undefined> {
  return findOrderById(tx, sellerOrder.orderId);
}

/**
 * DB-06: with `from`, the update only applies while the status is still `from` (a conditional update);
 * returns undefined when the row is missing or someone else moved it first.
 */
export async function updateSellerOrder(
  tx: Tx,
  id: string,
  patch: Partial<SellerOrder>,
  guard: { from?: SellerOrderStatus } = {},
): Promise<SellerOrder | undefined> {
  const data = clearing(sellerOrderColumns(patch)) as Prisma.SellerOrderUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).sellerOrder.updateMany({
    where: { id, ...(guard.from && { status: guard.from }) },
    data,
  });
  return count === 0 ? undefined : findSellerOrder(tx, id);
}

/**
 * BR-11 / DB-06: each seller order is paid out once. Only orders with no payout yet are linked; if another payout
 * run linked any of them first, this throws and the whole run rolls back, so no order is ever paid twice.
 */
export async function setPayoutOnSellerOrders(tx: Tx, sellerOrderIds: string[], payoutId: string): Promise<void> {
  const client = writableClientOf(tx);
  const { count } = await client.sellerOrder.updateMany({
    where: { id: { in: sellerOrderIds }, payoutId: null },
    data: { payoutId },
  });
  if (count === new Set(sellerOrderIds).size) return;
  const taken = await client.sellerOrder.count({
    where: { id: { in: sellerOrderIds }, payoutId: { not: null }, NOT: { payoutId } },
  });
  if (taken > 0) throw new ConflictError("These orders were just paid out by another run. Refresh and check.");
}

// ---------- Scheduled jobs (B06) ----------
// Each takes one batch of at most `limit` rows (JOB-06) and changes them with a conditional update (DB-06), so a
// second run, or a person acting at the same moment, never changes a row twice (JOB-03).

/** BR-08: cancels NEW seller orders whose accept deadline has passed. Returns the ones this call cancelled. */
export async function cancelOverdueNewSellerOrders(
  tx: Tx,
  now: Date,
  reason: string,
  limit: number,
): Promise<SellerOrder[]> {
  const client = writableClientOf(tx);
  const due = { status: "NEW", acceptDeadlineAt: { lte: now } } satisfies Prisma.SellerOrderWhereInput;
  const ids = await client.sellerOrder.findMany({
    where: due,
    select: { id: true },
    orderBy: [{ acceptDeadlineAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  if (!ids.length) return [];
  const rows = await client.sellerOrder.updateManyAndReturn({
    where: { id: { in: ids.map((r) => r.id) }, ...due },
    data: { status: "CANCELLED", cancelReason: reason, updatedAt: now },
  });
  return rows.map(toSellerOrder);
}

/** BR-17: completes seller orders dispatched at or before `dispatchedBefore`. Returns the ones this call completed. */
export async function completeLongDispatchedSellerOrders(
  tx: Tx,
  dispatchedBefore: Date,
  now: Date,
  limit: number,
): Promise<SellerOrder[]> {
  const client = writableClientOf(tx);
  const due = { status: "DISPATCHED", dispatchedAt: { lte: dispatchedBefore } } satisfies Prisma.SellerOrderWhereInput;
  const ids = await client.sellerOrder.findMany({
    where: due,
    select: { id: true },
    orderBy: [{ dispatchedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  if (!ids.length) return [];
  const rows = await client.sellerOrder.updateManyAndReturn({
    where: { id: { in: ids.map((r) => r.id) }, ...due },
    data: { status: "COMPLETED", completedAt: now, updatedAt: now },
  });
  return rows.map(toSellerOrder);
}

/** Who to tell about each seller order: the customer (with the order number) and the shop's owner. One query. */
export async function partiesOfSellerOrders(
  tx: Tx,
  sellerOrderIds: string[],
): Promise<Map<string, { orderNumber: string; customerId: string; shopOwnerId: string; shopName: string }>> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { id: { in: sellerOrderIds } },
    select: {
      id: true,
      order: { select: { orderNumber: true, customerId: true } },
      shop: { select: { ownerId: true, name: true } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        orderNumber: r.order.orderNumber,
        customerId: r.order.customerId,
        shopOwnerId: r.shop.ownerId,
        shopName: r.shop.name,
      },
    ]),
  );
}

/** BR-11: shops with delivered orders not yet in a payout, by id, after `afterShopId` (keyset paging, JOB-06). */
export async function shopsWithUnpaidCompletedOrders(
  tx: Tx,
  afterShopId: string | undefined,
  limit: number,
): Promise<string[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { status: "COMPLETED", payoutId: null, ...(afterShopId && { shopId: { gt: afterShopId } }) },
    select: { shopId: true },
    distinct: ["shopId"],
    orderBy: { shopId: "asc" },
    take: limit,
  });
  return rows.map((r) => r.shopId);
}

/** FR-14: expires open requests and unanswered quotes last changed at or before `staleBefore`. */
export async function expireStaleCustomRequests(
  tx: Tx,
  staleBefore: Date,
  now: Date,
  limit: number,
): Promise<CustomRequest[]> {
  const client = writableClientOf(tx);
  const due = {
    status: { in: ["OPEN", "QUOTED"] },
    updatedAt: { lte: staleBefore },
  } satisfies Prisma.CustomRequestWhereInput;
  const ids = await client.customRequest.findMany({
    where: due,
    select: { id: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  if (!ids.length) return [];
  const rows = await client.customRequest.updateManyAndReturn({
    where: { id: { in: ids.map((r) => r.id) }, ...due },
    data: { status: "EXPIRED", updatedAt: now },
  });
  return rows.map(toCustomRequest);
}

// ---------- Order items ----------

export async function itemsOfSellerOrder(tx: Tx, sellerOrderId: string): Promise<OrderItem[]> {
  const rows = await clientOf(tx).orderItem.findMany({ where: { sellerOrderId }, orderBy: { id: "asc" } });
  return rows.map(toOrderItem);
}

export async function itemsOfSellerOrders(tx: Tx, sellerOrderIds: string[]): Promise<OrderItem[]> {
  const rows = await clientOf(tx).orderItem.findMany({
    where: { sellerOrderId: { in: sellerOrderIds } },
    orderBy: { id: "asc" },
  });
  return rows.map(toOrderItem);
}

export async function findOrderItem(tx: Tx, id: string): Promise<OrderItem | undefined> {
  const row = await clientOf(tx).orderItem.findUnique({ where: { id } });
  return row ? toOrderItem(row) : undefined;
}

// ---------- Payouts ----------

export async function payoutsOfShop(tx: Tx, shopId: string): Promise<Payout[]> {
  const rows = await clientOf(tx).payout.findMany({
    where: { shopId },
    include: payoutInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toPayout);
}

export async function listPayouts(tx: Tx): Promise<Payout[]> {
  const rows = await clientOf(tx).payout.findMany({
    include: payoutInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toPayout);
}

export async function findPayout(tx: Tx, id: string): Promise<Payout | undefined> {
  const row = await clientOf(tx).payout.findUnique({ where: { id }, include: payoutInclude });
  return row ? toPayout(row) : undefined;
}

/** Stores the payout; its seller orders are linked by setPayoutOnSellerOrders in the same transaction. */
export async function insertPayout(tx: Tx, payout: Payout): Promise<Payout> {
  const data = payoutColumns(payout) as Prisma.PayoutUncheckedCreateInput;
  await writableClientOf(tx).payout.create({ data });
  return payout;
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updatePayout(
  tx: Tx,
  id: string,
  patch: Partial<Payout>,
  guard: { from?: Payout["status"] } = {},
): Promise<Payout | undefined> {
  const data = clearing(payoutColumns(patch)) as Prisma.PayoutUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).payout.updateMany({
    where: { id, ...(guard.from && { status: guard.from }) },
    data,
  });
  return count === 0 ? undefined : findPayout(tx, id);
}

// ---------- Custom requests (FR-14) ----------

export async function findCustomRequest(tx: Tx, id: string): Promise<CustomRequest | undefined> {
  const row = await clientOf(tx).customRequest.findUnique({ where: { id } });
  return row ? toCustomRequest(row) : undefined;
}

export async function insertCustomRequest(tx: Tx, request: CustomRequest): Promise<CustomRequest> {
  const data = customRequestColumns(request) as Prisma.CustomRequestUncheckedCreateInput;
  return toCustomRequest(await writableClientOf(tx).customRequest.create({ data }));
}

export async function updateCustomRequest(
  tx: Tx,
  id: string,
  patch: Partial<CustomRequest>,
): Promise<CustomRequest | undefined> {
  const data = clearing(customRequestColumns(patch)) as Prisma.CustomRequestUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).customRequest.updateMany({ where: { id }, data });
  return count === 0 ? undefined : findCustomRequest(tx, id);
}

export async function customRequestsOfCustomer(tx: Tx, customerId: string): Promise<CustomRequest[]> {
  const rows = await clientOf(tx).customRequest.findMany({
    where: { customerId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toCustomRequest);
}

export async function customRequestsOfShop(tx: Tx, shopId: string): Promise<CustomRequest[]> {
  const rows = await clientOf(tx).customRequest.findMany({
    where: { shopId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toCustomRequest);
}

export async function renameCustomerOnRequests(tx: Tx, customerId: string, customerName: string): Promise<void> {
  await writableClientOf(tx).customRequest.updateMany({ where: { customerId }, data: { customerName } });
}
