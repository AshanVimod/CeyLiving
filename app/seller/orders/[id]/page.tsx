import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { SellerOrderActions } from "@/components/seller/order-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { BUYER_DATA_VISIBLE_DAYS } from "@/lib/config";
import { formatDate, formatLkr } from "@/lib/format";
import { NotFoundError } from "@/lib/server/errors";
import { requireRole } from "@/lib/server/auth";
import { buyerContactFor, sellerOrderForSeller } from "@/lib/server/services/orders";

export const metadata = { title: "Order" };

async function SellerOrder({ params }: { params: PageProps<"/seller/orders/[id]">["params"] }) {
  const { id } = await params;
  const user = await requireRole(["SELLER"], `/seller/orders/${id}`);
  let detail;
  try {
    detail = sellerOrderForSeller(user, id); // other shops' orders are "not found" (SEC-A5)
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { sellerOrder: so, order, items } = detail;
  const buyer = buyerContactFor(so, order);
  return (
    <>
      <p className="mb-3">
        <Link href="/seller/orders" className="text-sm font-semibold text-forest underline underline-offset-4">
          All orders
        </Link>
      </p>
      <PageTitle title={order.orderNumber} description={`Placed ${formatDate(order.placedAt)}.`} action={<StatusBadge status={so.status} />} />
      <div className="space-y-6">
        <section aria-label="Items" className="rounded-lg border border-line bg-paper-raised p-5">
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2 py-3 first:pt-0">
                <span>
                  {i.quantity} × {i.productTitle}
                  {i.variantLabel ? <span className="text-ink-soft">, {i.variantLabel}</span> : null}
                </span>
                <span className="tabular-nums">{formatLkr(i.unitPriceCents * i.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-line pt-3 font-semibold">
            <span>Total with delivery</span>
            <span className="tabular-nums">{formatLkr(so.subtotalCents + so.shippingCents)}</span>
          </p>
        </section>

        <section aria-labelledby="buyer-h" className="rounded-lg border border-line bg-paper-raised p-5">
          <h2 id="buyer-h" className="font-sans text-base font-semibold">
            Deliver to
          </h2>
          {buyer ? (
            <address className="mt-2 not-italic text-ink-soft">
              {buyer.recipientName}
              <br />
              {buyer.line1}
              {buyer.line2 ? `, ${buyer.line2}` : ""}
              <br />
              {buyer.city}, {buyer.district} {buyer.postalCode}
              <br />
              {buyer.phone}
            </address>
          ) : (
            <p className="mt-2 text-ink-soft">Buyer details are hidden for cancelled orders and {BUYER_DATA_VISIBLE_DAYS} days after delivery.</p>
          )}
        </section>

        {so.courierName ? (
          <p className="text-ink-soft">
            Dispatched with {so.courierName}
            {so.trackingRef ? `, tracking ${so.trackingRef}` : ""}
            {so.dispatchedAt ? ` on ${formatDate(so.dispatchedAt)}` : ""}.
          </p>
        ) : null}
        {so.cancelReason ? <p className="text-ink-soft">Cancelled: {so.cancelReason}</p> : null}
        {so.status === "DISPATCHED" ? <p className="text-ink-soft">Waiting for the customer to confirm delivery.</p> : null}

        <SellerOrderActions sellerOrderId={so.id} status={so.status} />
      </div>
    </>
  );
}

export default function SellerOrderPage(props: PageProps<"/seller/orders/[id]">) {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
      <SellerOrder params={props.params} />
    </Suspense>
  );
}
