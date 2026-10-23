import { z } from "zod";
import { SHOP_SLUG, TEXT_LIMITS } from "../config";
import { district, optionalText, reason, text } from "./common";
import { photoInput } from "./photo";

/** RULE-S2: lowercase letters, numbers and hyphens, 3–60 characters, not a reserved word. */
export const shopSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(SHOP_SLUG.min, `The web address needs at least ${SHOP_SLUG.min} characters.`)
  .max(SHOP_SLUG.max, `The web address can be at most ${SHOP_SLUG.max} characters.`)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens only.")
  .refine((s) => !(SHOP_SLUG.reserved as readonly string[]).includes(s), "That web address is reserved. Choose another.");

export const shopSchema = z.object({
  name: text("a shop name", 3, 60),
  slug: shopSlug,
  craft: text("your craft", 3, 120),
  district,
  story: text("your story", TEXT_LIMITS.storyMin, TEXT_LIMITS.storyMax),
  quote: optionalText("the quote", 160),
  dispatchDays: text("the dispatch time", 5, 60),
  returnPolicy: text("the return policy", 10, 300),
  logo: photoInput,
  banner: photoInput,
});

export type ShopInput = z.infer<typeof shopSchema>;

export const payoutSchema = z.object({
  bankName: text("the bank name", 3, 60),
  accountNumber: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{8,16}$/, "Enter the account number: 8 to 16 digits.")),
});

export type PayoutInput = z.infer<typeof payoutSchema>;

export const shopDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("suspend"), shopId: z.string().min(1), reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax) }),
  z.object({ decision: z.literal("reinstate"), shopId: z.string().min(1) }),
  z.object({ decision: z.literal("verify"), shopId: z.string().min(1) }),
  z.object({ decision: z.literal("unverify"), shopId: z.string().min(1) }),
  z.object({ decision: z.literal("close"), shopId: z.string().min(1), reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax) }),
]);

export type ShopDecisionInput = z.infer<typeof shopDecisionSchema>;
