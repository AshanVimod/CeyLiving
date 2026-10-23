import { z } from "zod";
import { TEXT_LIMITS as T } from "../config";
import { id, optionalText, postText, reason, text, type Loose } from "./common";
import { CONTACT_DETAILS_MESSAGE, findContactDetails } from "./contact";

const rupeesToCents = (label: string, required: boolean) =>
  z
    .string()
    .optional()
    .transform((s) => (s ?? "").replace(/[,\s]/g, ""))
    .refine((s) => !required || s !== "", `Enter ${label}.`)
    .refine((s) => s === "" || (/^\d+(\.\d{1,2})?$/.test(s) && Number(s) >= 1 && Number(s) <= 100_000), `Enter ${label} between LKR 1 and LKR 100,000.`)
    .transform((s) => (s === "" ? undefined : Math.round(Number(s) * 100)));

/** FR-14: a customer's request to a maker. RULE-Q4 applies: no contact details. */
export const customRequestSchema = z.object({
  shopId: id,
  message: postText("your request", 20, 1000),
  budget: rupeesToCents("a budget", false),
});

export const quoteSchema = z.object({
  requestId: id,
  price: rupeesToCents("the price", true).pipe(z.number()),
  days: z.coerce.number({ error: "Enter the number of days." }).int("Enter whole days.").min(1, "At least 1 day.").max(120, "At most 120 days."),
  message: optionalText("the message", 500).refine((s) => !s || !findContactDetails(s), CONTACT_DETAILS_MESSAGE),
});

export const declineRequestSchema = z.object({ requestId: id, reason: text("a reason", 5, 300) });

export const quoteResponseSchema = z.object({ requestId: id, response: z.enum(["accept", "decline"]) });

/** FR-16: admins can promote a customer to admin; every change is audited with a reason. */
export const roleChangeSchema = z.object({ userId: id, role: z.literal("ADMIN"), reason: reason(T.reasonMin, T.reasonMax) });

/** FR-17: the person types DELETE to confirm; nothing else is accepted. */
export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE", { error: "Type DELETE in capital letters to confirm." }),
});

export const voteSchema = z.object({ targetType: z.enum(["REVIEW", "QUESTION"]), targetId: id });

export const payoutPaidSchema = z.object({
  payoutId: id,
  reference: z.string().trim().min(4, "Enter the bank reference.").max(40).regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only."),
});

export type CustomRequestInput = Loose<z.infer<typeof customRequestSchema>>;
export type QuoteInput = Loose<z.infer<typeof quoteSchema>>;
export type RoleChangeInput = z.infer<typeof roleChangeSchema>;
export type VoteInput = z.infer<typeof voteSchema>;
