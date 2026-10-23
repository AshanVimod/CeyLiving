import { currentUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db/tx";
import { visibleReviewsOfProduct } from "@/lib/server/repositories/content";
import { byHelpfulness, helpfulCounts } from "@/lib/server/services/community-extras";
import { ReviewList } from "./review-list";

/** Static first paint: reviews sorted by helpfulness, no viewer state. */
export async function ProductReviewsStatic({ productId, shopName }: { productId: string; shopName: string }) {
  const reviews = await visibleReviewsOfProduct(db, productId);
  const { counts } = await helpfulCounts(
    "REVIEW",
    reviews.map((r) => r.id),
  );
  return <ReviewList reviews={byHelpfulness(reviews, counts)} shopName={shopName} />;
}

/** FR-19: the same list with the viewer's votes, streamed in once the session is known. */
export async function ProductReviews({ productId, shopName }: { productId: string; shopName: string }) {
  const user = await currentUser();
  const reviews = await visibleReviewsOfProduct(db, productId);
  const { counts, mine } = await helpfulCounts(
    "REVIEW",
    reviews.map((r) => r.id),
    user?.id,
  );
  return (
    <ReviewList
      reviews={byHelpfulness(reviews, counts)}
      shopName={shopName}
      helpful={{ counts, mine, viewerId: user?.id }}
    />
  );
}
