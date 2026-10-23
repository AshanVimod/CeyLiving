import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConfirmDeliveryForm } from "@/components/account/order-actions";
import { PageTitle } from "@/components/account/area-shell";
import { ReviewForm } from "@/components/reviews/review-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { REVIEW_EDIT_DAYS } from "@/lib/config";
import { daysSince, formatDate, formatLkr } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { findOrderByNumber } from "@/lib/server/repositories/commerce";
import { customerOrder } from "@/lib/server/services/orders";
import { reviewableItems } from "@/lib/server/services/reviews";
import { readStore } from "@/lib/server/store/dev-store";

export const metadata: Metadata = { title: "Order" };

async function OrderDetail({ params }: { params: PageProps<"/account/orders/[orderNumber]">["params"] }) {
  const { orderNumber } = await params;
  const user = await requireUser(`/account/orders/${orderNumber}`);
  const db = readStore();
  try {
    customerOrder(user, orderNumber, db); // SEC-A5: other people's orders are "not found"
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { order, sellerOrders } = findOrderByNumber(orderNumber, db)!;
  const reviewable = new Set(reviewableItems(user, db).map((i) => i.id));
  const reviewsByItem = new Map(db.reviews.filter((r) => r.authorId === user.id).map((r) => [r.orderItemId, r]));
  const a = order.shippingAddress;
  return (
    <>
      <p className="mb-3">
        <Link href="/account/orders" className="text-sm font-semibold text-forest underline underline-offset-4">
          All orders
        </Link>
      </p>
      <PageTitle title={order.orderNumber} description={`Placed ${formatDate(order.placedAt)}. Total ${formatLkr(order.totalCents)}.`} />
      <div className="space-y-6">
        {sellerOrders.map(({ sellerOrder, items }) => {
          const shop = db.shops.find((s) => s.id === sellerOrder.shopId);
          return (
            <section key={sellerOrder.id} aria-label={`From ${shop?.name}`} className="rounded-lg border border-line bg-paper-raised">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
                <h2 className="font-sans text-base font-semibold">From {shop?.name}</h2>
                <StatusBadge status={sellerOrder.status} />
              </header>
              <div className="space-y-4 px-5 py-4">
                {sellerOrder.status === "DISPATCHED" ? (
                  <div className="rounded-md bg-sage p-4">
                    <p>
                      Sent with {sellerOrder.courierName}
                      {sellerOrder.trackingRef ? `, tracking ${sellerOrder.trackingRef}` : ""}.
                    </p>
                    <p className="mb-3 text-sm text-ink-soft">Let us know when it arrives. That also lets you review it.</p>
                    <ConfirmDeliveryForm sellerOrderId={sellerOrder.id} />
                  </div>
                ) : null}
                {sellerOrder.status === "CANCELLED" && sellerOrder.cancelReason ? <p className="text-ink-soft">Cancelled: {sellerOrder.cancelReason}</p> : null}
                <ul className="divide-y divide-line">
                  {items.map((item) => {
                    const review = reviewsByItem.get(item.id);
                    return (
                      <li key={item.id} className="py-4 first:pt-0">
                        <p className="flex flex-wrap justify-between gap-2">
                          <span className="font-medium">
                            {item.quantity} × {item.productTitle}
                            {item.variantLabel ? <span className="text-ink-soft">, {item.variantLabel}</span> : null}
                          </span>
                          <span className="tabular-nums">{formatLkr(item.unitPriceCents * item.quantity)}</span>
                        </p>
                        {reviewable.has(item.id) ? (
                          <details className="mt-3 rounded-md border border-line p-4">
                            <summary className="cursor-pointer font-semibold text-forest">Write a review</summary>
                            <div className="mt-4">
                              <ReviewForm orderItemId={item.id} />
                            </div>
                          </details>
                        ) : null}
                        {review ? (
                          <p className="mt-2 text-sm text-ink-soft">
                            You reviewed this ({review.rating} of 5){review.status === "HIDDEN" ? ". Hidden by a moderator." : "."}
                          </p>
                        ) : null}
                        {review && review.status === "VISIBLE" && daysSince(review.createdAt) <= REVIEW_EDIT_DAYS ? (
                          <details className="mt-3 rounded-md border border-line p-4">
                            <summary className="cursor-pointer font-semibold text-forest">Edit your review</summary>
                            <div className="mt-4">
                              <ReviewForm review={{ id: review.id, rating: review.rating, comment: review.comment }} />
                            </div>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
        <section aria-labelledby="ship-h" className="rounded-lg border border-line bg-paper-raised p-5">
          <h2 id="ship-h" className="font-sans text-base font-semibold">
            Delivery address
          </h2>
          <address className="mt-2 not-italic text-ink-soft">
            {a.recipientName}, {a.line1}
            {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.district} {a.postalCode}. {a.phone}
          </address>
        </section>
      </div>
    </>
  );
}

export default function OrderPage(props: PageProps<"/account/orders/[orderNumber]">) {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
      <OrderDetail params={props.params} />
    </Suspense>
  );
}
