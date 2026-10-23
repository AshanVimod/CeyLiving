import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatLkr } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { ordersOfCustomer } from "@/lib/server/repositories/commerce";
import { readStore } from "@/lib/server/store/dev-store";

export const metadata: Metadata = { title: "My orders" };

async function Orders() {
  const user = await requireUser("/account/orders");
  const db = readStore();
  const orders = ordersOfCustomer(user.id, db);
  if (!orders.length) {
    return (
      <EmptyState
        title="No orders yet"
        text="When you buy something it will appear here, with delivery updates."
        action={
          <Link href="/shop" className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep">
            Shop creations
          </Link>
        }
      />
    );
  }
  return (
    <ul className="space-y-4">
      {orders.map(({ order, sellerOrders }) => (
        <li key={order.id}>
          <Link href={`/account/orders/${order.orderNumber}`} className="block rounded-lg border border-line bg-paper-raised p-5 transition-colors hover:border-forest">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{order.orderNumber}</span>
              <span className="text-sm text-ink-soft">
                {formatDate(order.placedAt)}, {formatLkr(order.totalCents)}
              </span>
            </div>
            <ul className="mt-3 space-y-2">
              {sellerOrders.map(({ sellerOrder, items }) => (
                <li key={sellerOrder.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.95rem]">
                  <span className="min-w-0">
                    {items.map((i) => i.productTitle).join(", ")}
                    <span className="text-ink-soft"> from {db.shops.find((s) => s.id === sellerOrder.shopId)?.name}</span>
                  </span>
                  <StatusBadge status={sellerOrder.status} />
                </li>
              ))}
            </ul>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function OrdersPage() {
  return (
    <>
      <PageTitle title="My orders" description="Each shop ships separately, so one order can have several deliveries." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Orders />
      </Suspense>
    </>
  );
}
