import { z } from "zod";
import { MATERIALS, STYLES } from "../catalogue";
import { PRODUCT_LIMITS as L, TEXT_LIMITS } from "../config";
import { categories } from "../data/categories";
import { reason } from "./common";
import { photoInput } from "./photo";

const categorySlugs = categories.map((c) => c.slug) as [string, ...string[]];

/** Rupees as typed ("1,250.50") to integer cents; RULE-P3 keeps prices whole and in range. */
const rupees = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""))))
    .pipe(z.number({ error: `Enter ${label} in rupees.` }).finite(`Enter ${label} in rupees.`))
    .transform((n) => Math.round(n * 100))
    .pipe(z.number().int().min(L.priceMinCents, `${label} must be at least LKR ${L.priceMinCents / 100}.`).max(L.priceMaxCents, `${label} can be at most LKR ${(L.priceMaxCents / 100).toLocaleString("en-LK")}.`));

const variant = z.object({
  label: z.string().trim().min(1, "Name this option, for example Medium or Blue.").max(40, "Keep option names under 40 characters."),
  price: rupees("The price"),
  compareAt: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v))
    .pipe(rupees("The original price").optional()),
  stock: z.coerce.number({ error: "Enter the stock as a whole number." }).int("Enter the stock as a whole number.").min(0, "Stock can’t be negative.").max(L.stockMax, `Stock can be at most ${L.stockMax}.`),
});

const customField = z.object({
  label: z.string().trim().min(2, "Name the personalization field.").max(60),
  kind: z.enum(["TEXT", "SELECT"]),
  options: z
    .string()
    .optional()
    .transform((s) => (s ?? "").split(",").map((o) => o.trim()).filter(Boolean).slice(0, 12)),
  maxLength: z.coerce.number().int().min(1).max(L.customFieldMaxLength, `Personalization text can be at most ${L.customFieldMaxLength} characters.`),
  isRequired: z.boolean(),
  helper: z.string().trim().max(120).optional(),
});

const words = (max: number) =>
  z
    .string()
    .optional()
    .transform((s) => (s ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, max));

/**
 * One schema, two strictness levels: drafts only need a title; submitting needs every RULE-P1 field.
 */
export function productSchema(mode: "draft" | "submit") {
  const strict = mode === "submit";
  return z
    .object({
      title: z.string().trim().min(L.titleMin, `The title needs at least ${L.titleMin} characters.`).max(L.titleMax, `The title can be at most ${L.titleMax} characters.`),
      categorySlug: strict ? z.enum(categorySlugs, { error: "Choose a category." }) : z.union([z.enum(categorySlugs), z.literal("")]),
      subcategory: z.string().trim().max(60).default(""),
      description: z
        .string()
        .trim()
        .max(L.descriptionMax)
        .refine((s) => !strict || s.length >= L.descriptionMin, `The description needs at least ${L.descriptionMin} characters.`),
      materials: z.array(z.enum(MATERIALS)).max(MATERIALS.length).default([]),
      materialNote: z.string().trim().max(160).default(""),
      styles: z.array(z.enum(STYLES)).max(STYLES.length).default([]),
      tags: words(10),
      type: z.enum(["READY_TO_SHIP", "MADE_TO_ORDER"]),
      processingDays: z
        .union([z.string(), z.number()])
        .optional()
        .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
        .pipe(z.number().int("Enter whole days.").min(1, "At least 1 day.").max(L.processingDaysMax, `At most ${L.processingDaysMax} days.`).optional()),
      dimensions: z.string().trim().max(120).default(""),
      care: z.string().trim().max(400).default(""),
      isHeritage: z.boolean().default(false),
      isEcoFriendly: z.boolean().default(false),
      images: z.array(photoInput).max(L.maxImages, `Add at most ${L.maxImages} photos.`).refine((list) => !strict || list.length >= 1, "Add at least one photo with a description."),
      variants: z.array(variant).max(L.maxVariants, `Add at most ${L.maxVariants} options.`).refine((list) => !strict || list.length >= 1, "Add at least one option with a price."),
      customization: z.array(customField).max(L.maxCustomFields, `Add at most ${L.maxCustomFields} personalization fields.`).default([]),
    })
    .refine((p) => !strict || p.type !== "MADE_TO_ORDER" || p.processingDays !== undefined, {
      message: "Made-to-order items need a processing time.",
      path: ["processingDays"],
    })
    .refine((p) => p.variants.every((v) => v.compareAt === undefined || v.compareAt > v.price), {
      message: "The original price must be higher than the price.",
      path: ["variants"],
    });
}

export type ProductInput = z.infer<ReturnType<typeof productSchema>>;

export const productDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), productId: z.string().min(1) }),
  z.object({ decision: z.literal("reject"), productId: z.string().min(1), reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax) }),
  z.object({ decision: z.literal("remove"), productId: z.string().min(1), reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax) }),
]);

export type ProductDecisionInput = z.infer<typeof productDecisionSchema>;
