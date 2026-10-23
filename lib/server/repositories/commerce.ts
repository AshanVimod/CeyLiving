import "server-only";
import type { Order, OrderItem, SellerOrder } from "@/lib/types";
import { readStore, type StoreData } from "../store/dev-store";

// Orders, seller orders and order items.

export interface OrderWithParts {
  order: Order;
  sellerOrders: { sellerOrder: SellerOrder; items: OrderItem[] }[];
}

function assemble(order: Order, db: StoreData): OrderWithParts {
  return {
    order,
    sellerOrders: db.sellerOrders
      .filter((so) => so.orderId === order.id)
      .map((sellerOrder) => ({ sellerOrder, items: db.orderItems.filter((i) => i.sellerOrderId === sellerOrder.id) })),
  };
}

export function ordersOfCustomer(customerId: string, db: StoreData = readStore()): OrderWithParts[] {
  return db.orders
    .filter((o) => o.customerId === customerId)
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .map((o) => assemble(o, db));
}

export function findOrderByNumber(orderNumber: string, db: StoreData = readStore()): OrderWithParts | undefined {
  const order = db.orders.find((o) => o.orderNumber === orderNumber);
  return order ? assemble(order, db) : undefined;
}

export function findSellerOrder(id: string, db: StoreData = readStore()): SellerOrder | undefined {
  return db.sellerOrders.find((so) => so.id === id);
}

export function sellerOrdersOfShop(shopId: string, db: StoreData = readStore()): SellerOrder[] {
  return db.sellerOrders.filter((so) => so.shopId === shopId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function orderOfSellerOrder(sellerOrder: SellerOrder, db: StoreData = readStore()): Order | undefined {
  return db.orders.find((o) => o.id === sellerOrder.orderId);
}

export function itemsOfSellerOrder(sellerOrderId: string, db: StoreData = readStore()): OrderItem[] {
  return db.orderItems.filter((i) => i.sellerOrderId === sellerOrderId);
}

export function findOrderItem(id: string, db: StoreData = readStore()): OrderItem | undefined {
  return db.orderItems.find((i) => i.id === id);
}
