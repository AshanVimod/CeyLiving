import { z } from "zod";
import { TEXT_LIMITS } from "../config";
import { categories } from "../data/categories";
import { district, httpsUrl, optionalText, phone, reason, text } from "./common";
import { photoUrl } from "./photo";

const categorySlugs = categories.map((c) => c.slug) as [string, ...string[]];

/** FR-2a: categories a shop plans to sell in. */
export const MAX_APPLICATION_CATEGORIES = 6;

/** FR-2a: the shop's dispatch address. Field names in the form are `address.line1` and so on. */
export const shopAddressSchema = z.object({
  line1: text("the first address line", 3, 120),
  line2: optionalText("the second address line", 120),
  city: text("the city", 2, 60),
  district,
  postalCode: optionalText("the postal code", 10),
});

/** FR-2a: the application to open a shop. */
export const applicationSchema = z
  .object({
    applicantName: text("your full name", 2, 80),
    phone,
    businessType: z.enum(["INDIVIDUAL", "REGISTERED_BUSINESS"], {
      error: "Choose whether you sell as an individual or a registered business.",
    }),
    businessRegNo: optionalText("the business registration number", 30),
    shopName: text("a shop name", 3, 60),
    craft: text("your craft", 3, 120),
    categorySlugs: z
      .array(z.enum(categorySlugs, { error: "Choose categories from the list." }))
      .min(1, "Choose at least one category you plan to sell in.")
      .max(MAX_APPLICATION_CATEGORIES, `Choose at most ${MAX_APPLICATION_CATEGORIES} categories.`)
      .transform((list) => [...new Set(list)]),
    address: shopAddressSchema,
    story: text("your story", TEXT_LIMITS.storyMin, TEXT_LIMITS.storyMax),
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
  })
  // A registration number only belongs to a registered business.
  .transform((input) => (input.businessType === "INDIVIDUAL" ? { ...input, businessRegNo: undefined } : input));

export type ApplicationInput = z.infer<typeof applicationSchema>;

export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), applicationId: z.string().min(1) }),
  z.object({
    decision: z.literal("reject"),
    applicationId: z.string().min(1),
    reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax),
  }),
  z.object({
    decision: z.literal("changes"),
    applicationId: z.string().min(1),
    reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax),
  }),
]);

export type DecisionInput = z.infer<typeof decisionSchema>;
