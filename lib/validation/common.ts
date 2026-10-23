import { z } from "zod";
import { DISTRICTS } from "../districts";
import { CONTACT_DETAILS_MESSAGE, findContactDetails } from "./contact";

/** Trims, collapses runs of blank lines and checks length (SEC-A4). */
export function text(label: string, min: number, max: number) {
  return z
    .string({ error: `Enter ${label}.` })
    .transform((s) => s.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n"))
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `Enter ${label}.` : `${capitalize(label)} needs at least ${min} characters.`)
        .max(max, `${capitalize(label)} can be at most ${max} characters.`),
    );
}

export function optionalText(label: string, max: number) {
  return z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim())
    .pipe(z.string().max(max, `${capitalize(label)} can be at most ${max} characters.`))
    .transform((s) => s || undefined);
}

/** Text that must not contain emails, phone numbers or links (RULE-Q4). */
export function postText(label: string, min: number, max: number) {
  return text(label, min, max).refine((s) => !findContactDetails(s), CONTACT_DETAILS_MESSAGE);
}

export const phone = z
  .string({ error: "Enter a mobile number." })
  .transform((s) => s.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+94|0)7\d{8}$/, "Enter a Sri Lankan mobile number, for example 0771234567."));

export const optionalPhone = z
  .string()
  .optional()
  .transform((s) => (s ?? "").replace(/[\s-]/g, ""))
  .pipe(z.union([z.literal(""), z.string().regex(/^(\+94|0)7\d{8}$/, "Enter a Sri Lankan mobile number, for example 0771234567.")]))
  .transform((s) => s || undefined);

export const district = z.enum(DISTRICTS, { error: "Choose a district." });

export const reason = (min: number, max: number) => text("a reason", min, max);

export const httpsUrl = z
  .string()
  .trim()
  .url("Enter a full web address starting with https://")
  .refine((u) => u.startsWith("https://"), "Use an https:// address.");

export const id = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/, "Invalid reference.");

/** Makes keys that may be undefined optional, so service callers can leave them out. */
export type Loose<T> = { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] } & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
