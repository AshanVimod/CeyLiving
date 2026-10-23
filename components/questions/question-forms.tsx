"use client";

import { TEXT_LIMITS } from "@/lib/config";
import { answerQuestionAction, askQuestionAction } from "@/lib/server/actions/community";
import { ActionForm, FormTextArea } from "../forms/action-form";

/** FR-3b: ask the maker. Contact details are refused on the server (RULE-Q4); the helper text says so up front. */
export function AskQuestionForm({ productId }: { productId: string }) {
  return (
    <ActionForm action={askQuestionAction} submitLabel="Ask the maker" pendingLabel="Sending…" resetOnSuccess>
      <input type="hidden" name="productId" value={productId} />
      <FormTextArea
        label="Your question"
        name="body"
        required
        maxLength={TEXT_LIMITS.questionMax}
        helper={`${TEXT_LIMITS.questionMin}–${TEXT_LIMITS.questionMax} characters. Don’t include phone numbers, emails or links: answers are posted here for everyone.`}
      />
    </ActionForm>
  );
}

export function AnswerForm({ questionId, asTeam }: { questionId: string; asTeam: boolean }) {
  return (
    <ActionForm action={answerQuestionAction} submitLabel={asTeam ? "Answer as CeyLiving" : "Post answer"} pendingLabel="Posting…" resetOnSuccess>
      <input type="hidden" name="questionId" value={questionId} />
      <FormTextArea label="Your answer" name="body" required maxLength={TEXT_LIMITS.answerMax} helper="Shown publicly under the question." />
    </ActionForm>
  );
}
