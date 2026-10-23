import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { DomainError, ValidationError } from "./errors";

/**
 * Wraps an action body: domain errors become safe messages, unexpected errors are logged
 * server-side and shown generically (CS-14). Next.js redirects pass through untouched.
 */
export async function runAction(body: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    return (await body()) ?? { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof DomainError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    console.error("[action] unexpected error", error);
    return { ok: false, message: "Something went wrong on our side. Please try again." };
  }
}

/** Validates input with a zod schema; failures become field errors (SEC-A3). */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError("Some details need fixing. They’re marked below.", fieldErrors);
}

/** FormData to a plain object; repeated keys become arrays. */
export function formToObject(form: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    const existing = out[key];
    out[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return out;
}
