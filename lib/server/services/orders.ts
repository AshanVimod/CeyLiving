import "server-only";
import { AUTO_COMPLETE_DAYS, BUYER_DATA_VISIBLE_DAYS, PAYMENT_WINDOW_MINUTES } from "@/lib/config";
import type { Order, SellerOrder, SellerOrderStatus } from "@/lib/types";
import type { OrderTransitionInput } from "@/lib/validation/order";
import { db, withTx, type Tx } from "../db/tx";
import { queueEmail } from "../email/queue";
import { NotFoundError } from "../errors";
import { shopOfSeller, type Actor } from "../permissions";
import { findShopById, releaseStock } from "../repositories/catalogue";
import {
  cancelOverdueNewSellerOrders,
  cancelSellerOrdersAwaitingPayment,
  completeLongDispatchedSellerOrders,
  findOrderById,
  findOrderByNumber,
  findSellerOrder,
  findSellerOrderForShop,
  itemsOfSellerOrder,
  markOrderExpired,
  partiesOfSellerOrders,
  reservedItemsOfOrder,
  updateSellerOrder,
} from "../repositories/commerce";
import { enqueue } from "../repositories/jobs";
import { addNotification, addNotifications } from "../repositories/people";
import { assertTransition, inBatches, staleStatus } from "./shared";

/** BR-06: the reason stored on seller orders cancelled because the order wasn't paid in time. */
export const UNPAID_CANCEL_REASON = `Not paid within ${PAYMENT_WINDOW_MINUTES} minutes (cancelled automatically).`;

/** BR-08: the reason stored on seller orders the accept-deadline job cancels. */
export const AUTO_CANCEL_REASON = "Not accepted by the maker in time (cancelled automatically).";

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
    // B10: the customer is emailed when the maker accepts and when it is sent (with courier and tracking).
    if (input.to === "ACCEPTED")
      await queueEmail(tx, "order.accepted", {
        userId: order.customerId,
        key: so.id,
        data: { orderNumber: order.orderNumber, shopName: shop.name },
      });
    if (input.to === "DISPATCHED" && updated.courierName)
      await queueEmail(tx, "order.dispatched", {
        userId: order.customerId,
        key: so.id,
        data: {
          orderNumber: order.orderNumber,
          shopName: shop.name,
          courierName: updated.courierName,
          trackingRef: updated.trackingRef || undefined,
        },
      });
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
    if (shop) {
      await addNotification(
        tx,
        shop.ownerId,
        "order.completed",
        `${order.orderNumber} was delivered`,
        `/seller/orders/${so.id}`,
      );
      // B10: the review invitation. Keyed by seller order, so it goes once even if the auto-complete job races this.
      await queueEmail(tx, "order.delivered", {
        userId: order.customerId,
        key: so.id,
        data: { orderNumber: order.orderNumber, shopName: shop.name, automatic: false },
      });
    }
  });
}

// ---------- Scheduled jobs (B06) ----------

/**
 * BR-08 (orders.autoCancelUnaccepted): NEW seller orders past their accept deadline are cancelled, and the customer
 * and the maker are told. The refund itself is recorded by an admin until B08 adds payments (PAY-07).
 */
export async function autoCancelUnacceptedOrders(now = new Date()): Promise<number> {
  return inBatches((limit) =>
    withTx(async (tx) => {
      const cancelled = await cancelOverdueNewSellerOrders(tx, now, AUTO_CANCEL_REASON, limit);
      const parties = await partiesOfSellerOrders(
        tx,
        cancelled.map((so) => so.id),
      );
      await addNotifications(
        tx,
        cancelled.flatMap((so) => {
          const p = parties.get(so.id)!;
          return [
            {
              userId: p.customerId,
              type: "order.cancelled",
              title: `Your order ${p.orderNumber} from ${p.shopName} was cancelled: the maker didn’t accept it in time`,
              href: `/account/orders/${p.orderNumber}`,
            },
            {
              userId: p.shopOwnerId,
              type: "order.cancelled",
              title: `${p.orderNumber} was cancelled because it wasn’t accepted in time`,
              href: `/seller/orders/${so.id}`,
            },
          ];
        }),
      );
      return cancelled.length;
    }),
  );
}

/**
 * BR-06 (orders.expireUnpaid): an order still unpaid at its expiry time is cancelled and the stock it took comes
 * back, in one transaction. JOB-03: only a PENDING order past expires_at changes, so a second run, or a run after
 * the payment arrived, does nothing. A run that comes too early (clock drift) throws, and pg-boss retries it later.
 */
export async function expireUnpaidOrder(
  orderId: string,
  now = new Date(),
): Promise<{ expired: boolean; stockReturned: number }> {
  return withTx(async (tx) => {
    const order = await markOrderExpired(tx, orderId, now);
    if (!order) {
      const current = await findOrderById(tx, orderId);
      if (current?.paymentStatus === "PENDING" && current.expiresAt && Date.parse(current.expiresAt) > now.getTime()) {
        throw new Error(`Order ${orderId} isn't due to expire until ${current.expiresAt}; retrying later.`);
      }
      return { expired: false, stockReturned: 0 };
    }
    await cancelSellerOrdersAwaitingPayment(tx, order.id, UNPAID_CANCEL_REASON, now);
    // Same order as checkout took them (product id, then sku), so this never deadlocks with a checkout.
    const reserved = await reservedItemsOfOrder(tx, order.id);
    for (const item of reserved) await releaseStock(tx, item.productId, item.variantSku, item.quantity);
    // The public catalogue is cached in the web app; ask it to read the returned stock (JOB-02: only if this commits).
    if (reserved.length) await enqueue(tx, "catalogue.refresh", {}, { singletonKey: "catalogue" });
    await addNotification(
      tx,
      order.customerId,
      "order.expired",
      `Your order ${order.orderNumber} was cancelled because it wasn’t paid within ${PAYMENT_WINDOW_MINUTES} minutes`,
      `/account/orders/${order.orderNumber}`,
    );
    return { expired: true, stockReturned: reserved.reduce((n, i) => n + i.quantity, 0) };
  });
}

/** BR-17 (orders.autoComplete): dispatched seller orders complete on their own this long after dispatch. */
export async function autoCompleteDispatchedOrders(now = new Date()): Promise<number> {
  const dispatchedBefore = new Date(now.getTime() - AUTO_COMPLETE_DAYS * 86_400_000);
  return inBatches((limit) =>
    withTx(async (tx) => {
      const completed = await completeLongDispatchedSellerOrders(tx, dispatchedBefore, now, limit);
      const parties = await partiesOfSellerOrders(
        tx,
        completed.map((so) => so.id),
      );
      await addNotifications(
        tx,
        completed.map((so) => {
          const p = parties.get(so.id)!;
          return {
            userId: p.shopOwnerId,
            type: "order.completed",
            title: `${p.orderNumber} was marked delivered ${AUTO_COMPLETE_DAYS} days after dispatch`,
            href: `/seller/orders/${so.id}`,
          };
        }),
      );
      for (const so of completed) {
        const p = parties.get(so.id)!;
        await queueEmail(tx, "order.delivered", {
          userId: p.customerId,
          key: so.id,
          data: { orderNumber: p.orderNumber, shopName: p.shopName, automatic: true },
        });
      }
      return completed.length;
    }),
  );
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
  if (["PENDING_PAYMENT", "CANCELLED", "REFUNDED"].includes(sellerOrder.status)) return undefined;
  if (
    sellerOrder.completedAt &&
    now.getTime() - Date.parse(sellerOrder.completedAt) > BUYER_DATA_VISIBLE_DAYS * 86_400_000
  )
    return undefined;
  return order.shippingAddress;
}
