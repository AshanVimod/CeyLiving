import Link from "next/link";
import { currentUser } from "@/lib/server/auth";
import { reviewEligibility } from "@/lib/server/services/reviews";
import { ReviewForm } from "./review-form";

/** Shows "Write a review" only to eligible buyers; everyone else sees why (FR-3a). */
export async function ProductReviewSlot({ productId, productSlug }: { productId: string; productSlug: string }) {
  const user = await currentUser();
  if (!user) {
    return (
      <p className="text-ink-soft">
        Bought this?{" "}
        <Link
          href={`/signin?next=${encodeURIComponent(`/p/${productSlug}#reviews`)}`}
          className="font-semibold text-forest underline underline-offset-4"
        >
          Sign in to review it
        </Link>
        .
      </p>
    );
  }
  const eligibility = reviewEligibility(user, productId);
  if (!eligibility.canReview) return <p className="text-ink-soft">{eligibility.reason}</p>;
  return (
    <section aria-labelledby="write-review" className="rounded-lg border border-line bg-paper-raised p-5">
      <h3 id="write-review" className="mb-4 font-sans text-lg font-semibold">
        Write a review
      </h3>
      <ReviewForm orderItemId={eligibility.orderItemId} />
    </section>
  );
}
