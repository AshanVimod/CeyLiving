"use client";

import { TEXT_LIMITS } from "@/lib/config";
import { replyToReviewAction } from "@/lib/server/actions/selling";
import { ActionForm, FormTextArea } from "../forms/action-form";

/** FR-18: one public reply per review, which the seller can edit. */
export function ReplyForm({ reviewId, existing }: { reviewId: string; existing?: string }) {
  return (
    <ActionForm
      action={replyToReviewAction}
      submitLabel={existing ? "Update reply" : "Post reply"}
      pendingLabel="Posting…"
    >
      <input type="hidden" name="reviewId" value={reviewId} />
      <FormTextArea
        label="Your public reply"
        name="body"
        required
        maxLength={TEXT_LIMITS.replyMax}
        defaultValue={existing}
        helper="Be polite and specific. No phone numbers, emails or links."
      />
    </ActionForm>
  );
}
