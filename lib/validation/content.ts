import { z } from "zod";
import { MUTE_DAY_OPTIONS, TEXT_LIMITS as T } from "../config";
import { id, optionalText, postText, reason, type Loose } from "./common";
import { CONTACT_DETAILS_MESSAGE, findContactDetails } from "./contact";

const optionalPostText = (label: string, min: number, max: number) =>
  optionalText(label, max)
    .refine(
      (s) => s === undefined || s.length >= min,
      `${label[0]!.toUpperCase()}${label.slice(1)} needs at least ${min} characters.`,
    )
    .refine((s) => s === undefined || !findContactDetails(s), CONTACT_DETAILS_MESSAGE);

/** RULE-R2: rating 1–5 is required; the comment is optional, 10–1,000 characters, no contact details. */
export const reviewSchema = z.object({
  orderItemId: id,
  rating: z.coerce
    .number({ error: "Choose a rating from 1 to 5 stars." })
    .int()
    .min(1, "Choose a rating from 1 to 5 stars.")
    .max(5, "Choose a rating from 1 to 5 stars."),
  comment: optionalPostText("your review", T.reviewMin, T.reviewMax),
});

export const editReviewSchema = reviewSchema.omit({ orderItemId: true }).extend({ reviewId: id });

export const replySchema = z.object({ reviewId: id, body: postText("your reply", 2, T.replyMax) });

export const questionSchema = z.object({
  productId: id,
  body: postText("your question", T.questionMin, T.questionMax),
});

export const answerSchema = z.object({ questionId: id, body: postText("your answer", 2, T.answerMax) });

const target = z.enum(["PRODUCT", "SHOP", "REVIEW", "QUESTION", "ANSWER"]);

export const reportSchema = z.object({
  targetType: target,
  targetId: id,
  reason: z.enum(
    [
      "Spam or advertising",
      "Offensive or abusive",
      "Contact details or off-site deal",
      "Counterfeit or copied design",
      "Prohibited item",
      "Something else",
    ],
    {
      error: "Choose a reason.",
    },
  ),
  details: optionalText("the details", T.reportDetailsMax),
});

export const moderationSchema = z
  .object({
    targetType: z.enum(["REVIEW", "QUESTION", "ANSWER"]),
    targetId: id,
    action: z.enum(["hide", "restore", "delete"]),
    reason: z
      .string()
      .optional()
      .transform((s) => (s ?? "").trim()),
  })
  .superRefine((v, ctx) => {
    // RULE-M1: hiding and deleting always need a reason.
    if (v.action !== "restore" && (v.reason.length < T.reasonMin || v.reason.length > T.reasonMax)) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `Give a reason of ${T.reasonMin}–${T.reasonMax} characters.`,
      });
    }
  });

export const officialReplySchema = z.object({
  targetType: z.enum(["REVIEW", "QUESTION"]),
  targetId: id,
  body: postText("the reply", 2, T.answerMax),
});

export const restrictionSchema = z
  .object({
    userId: id,
    action: z.enum(["mute", "ban", "lift"]),
    days: z.coerce.number().optional(),
    reason: reason(T.reasonMin, T.reasonMax),
  })
  .refine((v) => v.action !== "mute" || (MUTE_DAY_OPTIONS as readonly number[]).includes(v.days ?? 0), {
    message: `Choose ${MUTE_DAY_OPTIONS.join(" or ")} days.`,
    path: ["days"],
  });

export const reportResolutionSchema = z.object({
  reportId: id,
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolution: reason(T.reasonMin, T.reasonMax),
});

export type ReviewInput = Loose<z.infer<typeof reviewSchema>>;
export type EditReviewInput = Loose<z.infer<typeof editReviewSchema>>;
export type QuestionInput = Loose<z.infer<typeof questionSchema>>;
export type AnswerInput = Loose<z.infer<typeof answerSchema>>;
export type ReportInput = Loose<z.infer<typeof reportSchema>>;
export type ModerationInput = Loose<z.infer<typeof moderationSchema>>;
export type OfficialReplyInput = Loose<z.infer<typeof officialReplySchema>>;
export type RestrictionInput = Loose<z.infer<typeof restrictionSchema>>;
export type ReportResolutionInput = Loose<z.infer<typeof reportResolutionSchema>>;
