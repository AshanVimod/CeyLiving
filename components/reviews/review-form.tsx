"use client";

import { useId, useState } from "react";
import { TEXT_LIMITS } from "@/lib/config";
import { createReviewAction, editReviewAction } from "@/lib/server/actions/community";
import { ActionForm, FormTextArea, useFieldError } from "../forms/action-form";
import { StarIcon } from "../ui/icons";

function StarPicker({ initial }: { initial?: number }) {
  const [value, setValue] = useState(initial ?? 0);
  const error = useFieldError("rating");
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[0.95rem] font-medium">
        Your rating <span className="text-lacquer">*</span>
      </legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-turmeric has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-forest"
          >
            <input
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => setValue(n)}
              aria-describedby={error ? `${name}-err` : undefined}
              className="sr-only"
            />
            <StarIcon size={28} filled={n <= value} className={n <= value ? "" : "text-line"} />
            <span className="sr-only">
              {n} {n === 1 ? "star" : "stars"}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${name}-err`} role="alert" className="mt-1 text-sm text-lacquer">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** FR-3a: write (or edit) a review of a delivered item. Ownership and eligibility are checked on the server. */
export function ReviewForm({
  orderItemId,
  review,
}: {
  orderItemId?: string;
  review?: { id: string; rating: number; comment?: string };
}) {
  return (
    <ActionForm
      action={review ? editReviewAction : createReviewAction}
      submitLabel={review ? "Update review" : "Post review"}
      pendingLabel="Posting…"
    >
      {review ? (
        <input type="hidden" name="reviewId" value={review.id} />
      ) : (
        <input type="hidden" name="orderItemId" value={orderItemId} />
      )}
      <StarPicker initial={review?.rating} />
      <FormTextArea
        label="Your review (optional)"
        name="comment"
        maxLength={TEXT_LIMITS.reviewMax}
        defaultValue={review?.comment}
        helper={`${TEXT_LIMITS.reviewMin}–${TEXT_LIMITS.reviewMax} characters. No phone numbers, emails or links.`}
      />
    </ActionForm>
  );
}
