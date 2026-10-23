import { formatDate } from "@/lib/format";
import type { Review } from "@/lib/types";
import { ReportButton } from "../moderation/report-button";
import { Rating } from "../product/rating";
import { HelpfulButton } from "./helpful-button";

export interface HelpfulInfo {
  counts: Map<string, number>;
  mine: Set<string>;
  viewerId?: string;
}

interface ReviewListProps {
  reviews: Review[];
  shopName: string;
  productTitles?: Map<string, string>;
  /** FR-19 vote counts; leave out to hide the Helpful buttons. */
  helpful?: HelpfulInfo;
}

/** Public reviews. User text renders as plain text (SEC-A4); "Verified purchase" only when tied to an order (D-06). */
export function ReviewList({ reviews, shopName, productTitles, helpful }: ReviewListProps) {
  return (
    <ul className="grid gap-6 md:grid-cols-2">
      {reviews.map((r) => (
        <li key={r.id} id={`review-${r.id}`} className="border-t border-line pt-5">
          <Rating average={r.rating} size={13} />
          {r.comment ? (
            <p className="mt-2 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{r.comment}</p>
          ) : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
            <span>
              {r.authorName}
              {r.orderItemId ? ", verified purchase" : ""}
              {productTitles?.get(r.productId) ? ` on ${productTitles.get(r.productId)}` : ""},{" "}
              {formatDate(r.createdAt)}
              {r.editedAt ? " (edited)" : ""}
            </span>
            <ReportButton targetType="REVIEW" targetId={r.id} label="this review" />
          </p>
          {helpful ? (
            <div className="mt-2">
              <HelpfulButton
                targetType="REVIEW"
                targetId={r.id}
                count={helpful.counts.get(r.id) ?? 0}
                voted={helpful.mine.has(r.id)}
                disabled={helpful.viewerId === r.authorId}
              />
            </div>
          ) : null}
          {r.sellerReply ? (
            <div className="mt-3 border-l-2 border-forest pl-4">
              <p className="text-sm font-semibold">Reply from {shopName}</p>
              <p className="mt-1 text-sm text-ink-soft whitespace-pre-line [overflow-wrap:anywhere]">{r.sellerReply}</p>
            </div>
          ) : null}
          {r.ceylivingReply ? (
            <div className="mt-3 border-l-2 border-turmeric pl-4">
              <p className="text-sm font-semibold">CeyLiving team</p>
              <p className="mt-1 text-sm text-ink-soft whitespace-pre-line [overflow-wrap:anywhere]">
                {r.ceylivingReply}
              </p>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
