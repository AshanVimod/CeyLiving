import "server-only";
import { BUYER_DATA_VISIBLE_DAYS } from "@/lib/config";
import type { Order, SellerOrder, SellerOrderStatus } from "@/lib/types";
import type { OrderTransitionInput } from "@/lib/validation/order";
import { db, withTx, type Tx } from "../db/tx";
import { NotFoundError } from "../errors";
import { shopOfSeller, type Actor } from "../permissions";
import { findShopById } from "../repositories/catalogue";
import {
  findOrderById,
  findOrderByNumber,
  findSellerOrder,
  findSellerOrderForShop,
  itemsOfSellerOrder,
  updateSellerOrder,
} from "../repositories/commerce";
import { addNotification } from "../repositories/people";
import { assertTransition, staleStatus } from "./shared";

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

async function orderFor(tx: Tx, sellerOrder: SellerOrder): Promise<Order> {
  const order = await findOrderById(tx, sellerOrder.orderId);
  if (!order) throw new NotFoundError("Order not found.");
  return order;
}

/** Seller moves their own seller order along the status machine; other shops' orders look missing (SEC-A5). */
export async function transitionSellerOrder(
  actor: Actor,
  input: OrderTransitionInput,
  now = new Date(),
): Promise<SellerOrder> {
  return withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    const so = await findSellerOrderForShop(tx, input.sellerOrderId, shop.id);
    if (!so) throw new NotFoundError("Order not found.");
    assertTransition(SELLER_ORDER_FLOW, so.status, input.to, "order");
    const patch: Partial<SellerOrder> = { status: input.to, updatedAt: now.toISOString() };
    if (input.to === "ACCEPTED") patch.acceptedAt = now.toISOString();
    if (input.to === "DISPATCHED")
      Object.assign(patch, {
        courierName: input.courierName,
        trackingRef: input.trackingRef,
        dispatchedAt: now.toISOString(),
      });
    if (input.to === "CANCELLED") patch.cancelReason = input.reason;
    const updated = await updateSellerOrder(tx, so.id, patch, { from: so.status });
    if (!updated) throw staleStatus("order");
    const order = await orderFor(tx, updated);
    await addNotification(
      tx,
      order.customerId,
      `order.${input.to.toLowerCase()}`,
      `Your order ${order.orderNumber} from ${shop.name} ${MESSAGES[input.to]}`,
      `/account/orders/${order.orderNumber}`,
    );
    return updated;
  });
}

/** The customer confirms delivery (BR-17), which unlocks reviews (RULE-R1). */
export async function confirmDelivery(actor: Actor, sellerOrderId: string, now = new Date()): Promise<void> {
  await withTx(async (tx) => {
    const so = await findSellerOrder(tx, sellerOrderId);
    const order = so ? await orderFor(tx, so) : undefined;
    if (!so || !order || order.customerId !== actor.id) throw new NotFoundError("Order not found.");
    assertTransition(CUSTOMER_FLOW, so.status, "COMPLETED", "order");
    const updated = await updateSellerOrder(
      tx,
      so.id,
      { status: "COMPLETED", completedAt: now.toISOString(), updatedAt: now.toISOString() },
      { from: so.status },
    );
    if (!updated) throw staleStatus("order");
    const shop = await findShopById(tx, so.shopId);
    if (shop)
      await addNotification(
        tx,
        shop.ownerId,
        "order.completed",
        `${order.orderNumber} was delivered`,
        `/seller/orders/${so.id}`,
      );
  });
}

/** The customer's own order; anyone else gets "not found" (SEC-A5). */
export async function customerOrder(actor: Actor, orderNumber: string, tx: Tx = db) {
  const found = await findOrderByNumber(tx, orderNumber);
  if (!found || found.order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  return found.order;
}

/** A seller order of the seller's own shop, with its order and items. */
export async function sellerOrderForSeller(actor: Actor, sellerOrderId: string, tx: Tx = db) {
  const shop = await shopOfSeller(actor, tx);
  const sellerOrder = await findSellerOrderForShop(tx, sellerOrderId, shop.id);
  if (!sellerOrder) throw new NotFoundError("Order not found.");
  return {
    shop,
    sellerOrder,
    order: await orderFor(tx, sellerOrder),
    items: await itemsOfSellerOrder(tx, sellerOrder.id),
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
