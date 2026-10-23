import "server-only";
import type { CustomRequest, Order, OrderItem, Payout, SellerOrder, SellerOrderStatus } from "@/lib/types";
import { out, rowsOf, writableRowsOf, type Tx } from "../db/tx";
import type { StoreData } from "../store/dev-store";

// Orders, seller orders, order items, payouts and custom requests. The only code that touches these rows (BE-01).

export interface OrderWithParts {
  order: Order;
  sellerOrders: { sellerOrder: SellerOrder; items: OrderItem[] }[];
}

function assemble(order: Order, rows: StoreData): OrderWithParts {
  return {
    order,
    sellerOrders: rows.sellerOrders
      .filter((so) => so.orderId === order.id)
      .map((sellerOrder) => ({
        sellerOrder,
        items: rows.orderItems.filter((i) => i.sellerOrderId === sellerOrder.id),
      })),
  };
}

// ---------- Orders ----------

export async function ordersOfCustomer(tx: Tx, customerId: string): Promise<OrderWithParts[]> {
  const rows = rowsOf(tx);
  return out(
    tx,
    rows.orders
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
      .map((o) => assemble(o, rows)),
  );
}

export async function listOrdersOfCustomer(tx: Tx, customerId: string): Promise<Order[]> {
  return out(
    tx,
    rowsOf(tx).orders.filter((o) => o.customerId === customerId),
  );
}

export async function findOrderByNumber(tx: Tx, orderNumber: string): Promise<OrderWithParts | undefined> {
  const rows = rowsOf(tx);
  const order = rows.orders.find((o) => o.orderNumber === orderNumber);
  return order ? out(tx, assemble(order, rows)) : undefined;
}

export async function findOrderById(tx: Tx, id: string): Promise<Order | undefined> {
  return out(
    tx,
    rowsOf(tx).orders.find((o) => o.id === id),
  );
}

export async function updateOrder(tx: Tx, id: string, patch: Partial<Order>): Promise<void> {
  const order = writableRowsOf(tx).orders.find((o) => o.id === id);
  if (order) Object.assign(order, structuredClone(patch));
}

// ---------- Seller orders ----------

export async function findSellerOrder(tx: Tx, id: string): Promise<SellerOrder | undefined> {
  return out(
    tx,
    rowsOf(tx).sellerOrders.find((so) => so.id === id),
  );
}

/** SEC-A5: a seller order of this shop only; other shops' orders look missing. */
export async function findSellerOrderForShop(
  tx: Tx,
  sellerOrderId: string,
  shopId: string,
): Promise<SellerOrder | undefined> {
  return out(
    tx,
    rowsOf(tx).sellerOrders.find((so) => so.id === sellerOrderId && so.shopId === shopId),
  );
}

export async function sellerOrdersOfShop(tx: Tx, shopId: string): Promise<SellerOrder[]> {
  return out(
    tx,
    rowsOf(tx)
      .sellerOrders.filter((so) => so.shopId === shopId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

/** Every seller order belonging to one customer's orders. */
export async function sellerOrdersOfCustomer(tx: Tx, customerId: string): Promise<SellerOrder[]> {
  const rows = rowsOf(tx);
  const orderIds = new Set(rows.orders.filter((o) => o.customerId === customerId).map((o) => o.id));
  return out(
    tx,
    rows.sellerOrders.filter((so) => orderIds.has(so.orderId)),
  );
}

/** BR-11: delivered seller orders that aren't in any payout yet. */
export async function unpaidCompletedSellerOrders(tx: Tx, shopId?: string): Promise<SellerOrder[]> {
  return out(
    tx,
    rowsOf(tx).sellerOrders.filter(
      (so) => so.status === "COMPLETED" && !so.payoutId && (!shopId || so.shopId === shopId),
    ),
  );
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
  const sellerOrder = writableRowsOf(tx).sellerOrders.find((so) => so.id === id);
  if (!sellerOrder || (guard.from && sellerOrder.status !== guard.from)) return undefined;
  Object.assign(sellerOrder, structuredClone(patch));
  return out(tx, sellerOrder);
}

export async function setPayoutOnSellerOrders(tx: Tx, sellerOrderIds: string[], payoutId: string): Promise<void> {
  const ids = new Set(sellerOrderIds);
  writableRowsOf(tx)
    .sellerOrders.filter((so) => ids.has(so.id))
    .forEach((so) => (so.payoutId = payoutId));
}

// ---------- Order items ----------

export async function itemsOfSellerOrder(tx: Tx, sellerOrderId: string): Promise<OrderItem[]> {
  return out(
    tx,
    rowsOf(tx).orderItems.filter((i) => i.sellerOrderId === sellerOrderId),
  );
}

export async function itemsOfSellerOrders(tx: Tx, sellerOrderIds: string[]): Promise<OrderItem[]> {
  const ids = new Set(sellerOrderIds);
  return out(
    tx,
    rowsOf(tx).orderItems.filter((i) => ids.has(i.sellerOrderId)),
  );
}

export async function findOrderItem(tx: Tx, id: string): Promise<OrderItem | undefined> {
  return out(
    tx,
    rowsOf(tx).orderItems.find((i) => i.id === id),
  );
}

// ---------- Payouts ----------

export async function payoutsOfShop(tx: Tx, shopId: string): Promise<Payout[]> {
  return out(
    tx,
    rowsOf(tx)
      .payouts.filter((p) => p.shopId === shopId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export async function listPayouts(tx: Tx): Promise<Payout[]> {
  return out(
    tx,
    [...rowsOf(tx).payouts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export async function findPayout(tx: Tx, id: string): Promise<Payout | undefined> {
  return out(
    tx,
    rowsOf(tx).payouts.find((p) => p.id === id),
  );
}

export async function insertPayout(tx: Tx, payout: Payout): Promise<Payout> {
  writableRowsOf(tx).payouts.push(structuredClone(payout));
  return out(tx, payout);
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updatePayout(
  tx: Tx,
  id: string,
  patch: Partial<Payout>,
  guard: { from?: Payout["status"] } = {},
): Promise<Payout | undefined> {
  const payout = writableRowsOf(tx).payouts.find((p) => p.id === id);
  if (!payout || (guard.from && payout.status !== guard.from)) return undefined;
  Object.assign(payout, patch);
  return out(tx, payout);
}

// ---------- Custom requests (FR-14) ----------

export async function findCustomRequest(tx: Tx, id: string): Promise<CustomRequest | undefined> {
  return out(
    tx,
    rowsOf(tx).customRequests.find((r) => r.id === id),
  );
}

export async function insertCustomRequest(tx: Tx, request: CustomRequest): Promise<CustomRequest> {
  writableRowsOf(tx).customRequests.push(structuredClone(request));
  return out(tx, request);
}

export async function updateCustomRequest(
  tx: Tx,
  id: string,
  patch: Partial<CustomRequest>,
): Promise<CustomRequest | undefined> {
  const request = writableRowsOf(tx).customRequests.find((r) => r.id === id);
  if (!request) return undefined;
  Object.assign(request, structuredClone(patch));
  return out(tx, request);
}

export async function customRequestsOfCustomer(tx: Tx, customerId: string): Promise<CustomRequest[]> {
  return out(
    tx,
    rowsOf(tx)
      .customRequests.filter((r) => r.customerId === customerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

export async function customRequestsOfShop(tx: Tx, shopId: string): Promise<CustomRequest[]> {
  return out(
    tx,
    rowsOf(tx)
      .customRequests.filter((r) => r.shopId === shopId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );
}

export async function renameCustomerOnRequests(tx: Tx, customerId: string, customerName: string): Promise<void> {
  writableRowsOf(tx)
    .customRequests.filter((r) => r.customerId === customerId)
    .forEach((r) => (r.customerName = customerName));
}
