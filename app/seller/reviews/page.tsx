import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { Rating } from "@/components/product/rating";
import { ReplyForm } from "@/components/seller/reply-form";
import { formatDate } from "@/lib/format";
import { reviewsOfShop } from "@/lib/server/repositories/content";
import { sellerContext } from "@/lib/server/seller-context";

export const metadata = { title: "Reviews" };

async function Reviews() {
  const { shop, db } = await sellerContext("/seller/reviews");
  const reviews = reviewsOfShop(shop.id, db).filter((r) => r.status === "VISIBLE");
  if (!reviews.length) return <EmptyState title="No reviews yet" text="Reviews from customers who received your items appear here." />;
  const unreplied = reviews.filter((r) => !r.sellerReply);
  const ordered = [...unreplied, ...reviews.filter((r) => r.sellerReply)];
  return (
    <ul className="space-y-4">
      {ordered.map((r) => (
        <li key={r.id} className="rounded-lg border border-line bg-paper-raised p-5">
          <Rating average={r.rating} size={14} />
          <p className="mt-2 text-sm text-ink-soft">
            {r.authorName} on {db.products.find((p) => p.id === r.productId)?.title ?? "an item"}, {formatDate(r.createdAt)}
          </p>
          {r.comment ? <p className="mt-2 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{r.comment}</p> : null}
          <details className="mt-4" open={!r.sellerReply}>
            <summary className="cursor-pointer font-semibold text-forest">{r.sellerReply ? "Edit your reply" : "Reply"}</summary>
            <div className="mt-3">
              <ReplyForm reviewId={r.id} existing={r.sellerReply} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export default function SellerReviewsPage() {
  return (
    <>
      <PageTitle title="Reviews" description="You can reply once to each review. You can’t change or remove what customers wrote." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Reviews />
      </Suspense>
    </>
  );
}
