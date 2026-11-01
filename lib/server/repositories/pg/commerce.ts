import "server-only";
import type { CustomRequest, Order, OrderItem, Payout, SellerOrder, SellerOrderStatus } from "@/lib/types";
import type { Prisma } from "../../db/generated/client";
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
} from "../../db/mappers";
import { clientOf, writableClientOf, type PgTx } from "../../db/pg";
import { ConflictError } from "../../errors";
import type { OrderWithParts } from "../commerce";

// PostgreSQL version of repositories/commerce.ts: the same functions and results (checked by conformance.ts and
// test/contract). Lists the dev store keeps in insertion order are ordered by a stable key here.

export type { OrderWithParts };

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

export async function ordersOfCustomer(tx: PgTx, customerId: string): Promise<OrderWithParts[]> {
  const rows = await clientOf(tx).order.findMany({
    where: { customerId },
    include: orderParts,
    orderBy: [{ placedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(assemble);
}

export async function listOrdersOfCustomer(tx: PgTx, customerId: string): Promise<Order[]> {
  const rows = await clientOf(tx).order.findMany({
    where: { customerId },
    orderBy: [{ placedAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toOrder);
}

export async function findOrderByNumber(tx: PgTx, orderNumber: string): Promise<OrderWithParts | undefined> {
  const row = await clientOf(tx).order.findUnique({ where: { orderNumber }, include: orderParts });
  return row ? assemble(row) : undefined;
}

export async function findOrderById(tx: PgTx, id: string): Promise<Order | undefined> {
  const row = await clientOf(tx).order.findUnique({ where: { id } });
  return row ? toOrder(row) : undefined;
}

export async function updateOrder(tx: PgTx, id: string, patch: Partial<Order>): Promise<void> {
  const data = clearing(orderColumns(patch)) as Prisma.OrderUncheckedUpdateManyInput;
  await writableClientOf(tx).order.updateMany({ where: { id }, data });
}

// ---------- Seller orders ----------

export async function findSellerOrder(tx: PgTx, id: string): Promise<SellerOrder | undefined> {
  const row = await clientOf(tx).sellerOrder.findUnique({ where: { id } });
  return row ? toSellerOrder(row) : undefined;
}

/** SEC-A5: a seller order of this shop only; other shops' orders look missing. */
export async function findSellerOrderForShop(
  tx: PgTx,
  sellerOrderId: string,
  shopId: string,
): Promise<SellerOrder | undefined> {
  const row = await clientOf(tx).sellerOrder.findFirst({ where: { id: sellerOrderId, shopId } });
  return row ? toSellerOrder(row) : undefined;
}

export async function sellerOrdersOfShop(tx: PgTx, shopId: string): Promise<SellerOrder[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { shopId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toSellerOrder);
}

/** Every seller order belonging to one customer's orders. */
export async function sellerOrdersOfCustomer(tx: PgTx, customerId: string): Promise<SellerOrder[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { order: { customerId } },
    orderBy: { id: "asc" },
  });
  return rows.map(toSellerOrder);
}

/** BR-11: delivered seller orders that aren't in any payout yet. */
export async function unpaidCompletedSellerOrders(tx: PgTx, shopId?: string): Promise<SellerOrder[]> {
  const rows = await clientOf(tx).sellerOrder.findMany({
    where: { status: "COMPLETED", payoutId: null, ...(shopId && { shopId }) },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toSellerOrder);
}

export async function orderOfSellerOrder(tx: PgTx, sellerOrder: SellerOrder): Promise<Order | undefined> {
  return findOrderById(tx, sellerOrder.orderId);
}

/**
 * DB-06: with `from`, the update only applies while the status is still `from` (a conditional update);
 * returns undefined when the row is missing or someone else moved it first.
 */
export async function updateSellerOrder(
  tx: PgTx,
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
export async function setPayoutOnSellerOrders(tx: PgTx, sellerOrderIds: string[], payoutId: string): Promise<void> {
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

// ---------- Order items ----------

export async function itemsOfSellerOrder(tx: PgTx, sellerOrderId: string): Promise<OrderItem[]> {
  const rows = await clientOf(tx).orderItem.findMany({ where: { sellerOrderId }, orderBy: { id: "asc" } });
  return rows.map(toOrderItem);
}

export async function itemsOfSellerOrders(tx: PgTx, sellerOrderIds: string[]): Promise<OrderItem[]> {
  const rows = await clientOf(tx).orderItem.findMany({
    where: { sellerOrderId: { in: sellerOrderIds } },
    orderBy: { id: "asc" },
  });
  return rows.map(toOrderItem);
}

export async function findOrderItem(tx: PgTx, id: string): Promise<OrderItem | undefined> {
  const row = await clientOf(tx).orderItem.findUnique({ where: { id } });
  return row ? toOrderItem(row) : undefined;
}

// ---------- Payouts ----------

export async function payoutsOfShop(tx: PgTx, shopId: string): Promise<Payout[]> {
  const rows = await clientOf(tx).payout.findMany({
    where: { shopId },
    include: payoutInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toPayout);
}

export async function listPayouts(tx: PgTx): Promise<Payout[]> {
  const rows = await clientOf(tx).payout.findMany({
    include: payoutInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toPayout);
}

export async function findPayout(tx: PgTx, id: string): Promise<Payout | undefined> {
  const row = await clientOf(tx).payout.findUnique({ where: { id }, include: payoutInclude });
  return row ? toPayout(row) : undefined;
}

/** Stores the payout; its seller orders are linked by setPayoutOnSellerOrders in the same transaction. */
export async function insertPayout(tx: PgTx, payout: Payout): Promise<Payout> {
  const data = payoutColumns(payout) as Prisma.PayoutUncheckedCreateInput;
  await writableClientOf(tx).payout.create({ data });
  return payout;
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updatePayout(
  tx: PgTx,
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

export async function findCustomRequest(tx: PgTx, id: string): Promise<CustomRequest | undefined> {
  const row = await clientOf(tx).customRequest.findUnique({ where: { id } });
  return row ? toCustomRequest(row) : undefined;
}

export async function insertCustomRequest(tx: PgTx, request: CustomRequest): Promise<CustomRequest> {
  const data = customRequestColumns(request) as Prisma.CustomRequestUncheckedCreateInput;
  return toCustomRequest(await writableClientOf(tx).customRequest.create({ data }));
}

export async function updateCustomRequest(
  tx: PgTx,
  id: string,
  patch: Partial<CustomRequest>,
): Promise<CustomRequest | undefined> {
  const data = clearing(customRequestColumns(patch)) as Prisma.CustomRequestUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).customRequest.updateMany({ where: { id }, data });
  return count === 0 ? undefined : findCustomRequest(tx, id);
}

export async function customRequestsOfCustomer(tx: PgTx, customerId: string): Promise<CustomRequest[]> {
  const rows = await clientOf(tx).customRequest.findMany({
    where: { customerId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toCustomRequest);
}

export async function customRequestsOfShop(tx: PgTx, shopId: string): Promise<CustomRequest[]> {
  const rows = await clientOf(tx).customRequest.findMany({
    where: { shopId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toCustomRequest);
}

export async function renameCustomerOnRequests(tx: PgTx, customerId: string, customerName: string): Promise<void> {
  await writableClientOf(tx).customRequest.updateMany({ where: { customerId }, data: { customerName } });
}
