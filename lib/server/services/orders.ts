import "server-only";
import { BUYER_DATA_VISIBLE_DAYS } from "@/lib/config";
import type { Order, SellerOrder, SellerOrderStatus } from "@/lib/types";
import type { OrderTransitionInput } from "@/lib/validation/order";
import { NotFoundError } from "../errors";
import { shopOfSeller, type Actor } from "../permissions";
import { addNotification } from "../repositories/people";
import { readStore, transaction, type StoreData } from "../store/dev-store";
import { assertTransition } from "./shared";

// Spec BR-07: seller order status machine. Sellers move orders forward; customers confirm delivery.
export const SELLER_ORDER_FLOW: Partial<Record<SellerOrderStatus, readonly SellerOrderStatus[]>> = {
  NEW: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "DISPATCHED", "CANCELLED"],
  IN_PROGRESS: ["DISPATCHED", "CANCELLED"],
};

const CUSTOMER_FLOW: Partial<Record<SellerOrderStatus, readonly SellerOrderStatus[]>> = {
  DISPATCHED: ["COMPLETED"],
};

const MESSAGES: Partial<Record<SellerOrderStatus, string>> = {
  ACCEPTED: "was accepted by the maker",
  IN_PROGRESS: "is being made",
  DISPATCHED: "is on its way",
  CANCELLED: "was cancelled",
};

function orderFor(sellerOrder: SellerOrder, db: StoreData): Order {
  const order = db.orders.find((o) => o.id === sellerOrder.orderId);
  if (!order) throw new NotFoundError("Order not found.");
  return order;
}

/** Seller moves their own seller order along the status machine; other shops' orders look missing (SEC-A5). */
export async function transitionSellerOrder(
  actor: Actor,
  input: OrderTransitionInput,
  now = new Date(),
): Promise<SellerOrder> {
  return transaction((db) => {
    const shop = shopOfSeller(actor, db);
    const so = db.sellerOrders.find((s) => s.id === input.sellerOrderId && s.shopId === shop.id);
    if (!so) throw new NotFoundError("Order not found.");
    assertTransition(SELLER_ORDER_FLOW, so.status, input.to, "order");
    so.status = input.to;
    so.updatedAt = now.toISOString();
    if (input.to === "ACCEPTED") so.acceptedAt = now.toISOString();
    if (input.to === "DISPATCHED")
      Object.assign(so, {
        courierName: input.courierName,
        trackingRef: input.trackingRef,
        dispatchedAt: now.toISOString(),
      });
    if (input.to === "CANCELLED") so.cancelReason = input.reason;
    const order = orderFor(so, db);
    addNotification(
      db,
      order.customerId,
      `order.${input.to.toLowerCase()}`,
      `Your order ${order.orderNumber} from ${shop.name} ${MESSAGES[input.to]}`,
      `/account/orders/${order.orderNumber}`,
    );
    return so;
  });
}

/** The customer confirms delivery (BR-17), which unlocks reviews (RULE-R1). */
export async function confirmDelivery(actor: Actor, sellerOrderId: string, now = new Date()): Promise<void> {
  await transaction((db) => {
    const so = db.sellerOrders.find((s) => s.id === sellerOrderId);
    const order = so ? orderFor(so, db) : undefined;
    if (!so || !order || order.customerId !== actor.id) throw new NotFoundError("Order not found.");
    assertTransition(CUSTOMER_FLOW, so.status, "COMPLETED", "order");
    Object.assign(so, { status: "COMPLETED", completedAt: now.toISOString(), updatedAt: now.toISOString() });
    const shop = db.shops.find((s) => s.id === so.shopId);
    if (shop)
      addNotification(
        db,
        shop.ownerId,
        "order.completed",
        `${order.orderNumber} was delivered`,
        `/seller/orders/${so.id}`,
      );
  });
}

/** The customer's own order; anyone else gets "not found" (SEC-A5). */
export function customerOrder(actor: Actor, orderNumber: string, db: StoreData = readStore()) {
  const order = db.orders.find((o) => o.orderNumber === orderNumber && o.customerId === actor.id);
  if (!order) throw new NotFoundError("Order not found.");
  return order;
}

/** A seller order of the seller's own shop, with its order and items. */
export function sellerOrderForSeller(actor: Actor, sellerOrderId: string, db: StoreData = readStore()) {
  const shop = shopOfSeller(actor, db);
  const sellerOrder = db.sellerOrders.find((so) => so.id === sellerOrderId && so.shopId === shop.id);
  if (!sellerOrder) throw new NotFoundError("Order not found.");
  return {
    shop,
    sellerOrder,
    order: orderFor(sellerOrder, db),
    items: db.orderItems.filter((i) => i.sellerOrderId === sellerOrder.id),
  };
}

/**
 * SEC-A10 / BR-19: the seller sees the buyer's name, address and phone only for their own paid orders,
 * and only until 30 days after delivery. Cancelled orders show nothing.
 */
export function buyerContactFor(sellerOrder: SellerOrder, order: Order, now = new Date()) {
  if (sellerOrder.status === "CANCELLED" || sellerOrder.status === "REFUNDED") return undefined;
  if (
    sellerOrder.completedAt &&
    now.getTime() - Date.parse(sellerOrder.completedAt) > BUYER_DATA_VISIBLE_DAYS * 86_400_000
  )
    return undefined;
  return order.shippingAddress;
}
