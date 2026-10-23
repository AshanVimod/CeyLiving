import { z } from "zod";
import { TEXT_LIMITS } from "../config";
import { categories } from "../data/categories";
import { district, httpsUrl, phone, reason, text } from "./common";
import { photoUrl } from "./photo";

const categorySlugs = categories.map((c) => c.slug) as [string, ...string[]];

/** FR-2a: the apply-to-sell form. */
export const applicationSchema = z.object({
  shopName: text("a shop name", 3, 60),
  craft: text("your craft", 3, 120),
  categorySlug: z.enum(categorySlugs, { error: "Choose the category that fits your work best." }),
  district,
  story: text("your story", TEXT_LIMITS.storyMin, TEXT_LIMITS.storyMax),
  phone,
  workPhotoUrls: z
    .array(z.string())
    .transform((list) => list.map((u) => u.trim()).filter(Boolean))
    .pipe(z.array(photoUrl).min(3, "Add at least 3 photos of your work.").max(6, "Add at most 6 photos.")),
  socialUrl: z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim())
    .pipe(z.union([z.literal(""), httpsUrl]))
    .transform((s) => s || undefined),
  acceptTerms: z.literal("on", { error: "Accept the seller terms and the list of items that can’t be sold." }),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), applicationId: z.string().min(1) }),
  z.object({ decision: z.literal("reject"), applicationId: z.string().min(1), reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax) }),
  z.object({ decision: z.literal("changes"), applicationId: z.string().min(1), reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax) }),
]);

export type DecisionInput = z.infer<typeof decisionSchema>;
