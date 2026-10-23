import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatLkr } from "@/lib/format";
import { itemsOfSellerOrder, orderOfSellerOrder, sellerOrdersOfShop } from "@/lib/server/repositories/commerce";
import { sellerContext } from "@/lib/server/seller-context";

export const metadata = { title: "Orders" };

const ORDER: Record<string, number> = {
  NEW: 0,
  ACCEPTED: 1,
  IN_PROGRESS: 2,
  DISPATCHED: 3,
  COMPLETED: 4,
  CANCELLED: 5,
  REFUNDED: 6,
};

async function Orders() {
  const { shop, db } = await sellerContext("/seller/orders");
  const orders = sellerOrdersOfShop(shop.id, db).sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updatedAt.localeCompare(a.updatedAt),
  );
  if (!orders.length)
    return <EmptyState title="No orders yet" text="New orders appear here. Accept them within 3 days." />;
  return (
    <DataTable caption="Your orders" headers={["Order", "Items", "Total", "Placed", "Status"]}>
      {orders.map((so) => {
        const order = orderOfSellerOrder(so, db);
        const items = itemsOfSellerOrder(so.id, db);
        return (
          <tr key={so.id}>
            <Td>
              <Link href={`/seller/orders/${so.id}`} className="font-semibold text-forest underline underline-offset-4">
                {order?.orderNumber ?? so.id}
              </Link>
            </Td>
            <Td>{items.map((i) => `${i.quantity} × ${i.productTitle}`).join(", ")}</Td>
            <Td className="tabular-nums">{formatLkr(so.subtotalCents + so.shippingCents)}</Td>
            <Td>{order ? formatDate(order.placedAt) : ""}</Td>
            <Td>
              <StatusBadge status={so.status} />
            </Td>
          </tr>
        );
      })}
    </DataTable>
  );
}

export default function SellerOrdersPage() {
  return (
    <>
      <PageTitle title="Orders" description="New orders first. You only see orders for your own shop." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Orders />
      </Suspense>
    </>
  );
}
