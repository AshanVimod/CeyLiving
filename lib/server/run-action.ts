import "server-only";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { DomainError, ValidationError } from "./errors";
import { requestLogger } from "./observability/logger";

/**
 * Wraps an action body: domain errors become safe messages, unexpected errors are logged
 * server-side with the request ID and shown generically with that ID as a reference (CS-14, OPS-03).
 * Next.js redirects pass through untouched.
 */
export async function runAction(body: () => Promise<ActionResult | void>): Promise<ActionResult> {
  const started = performance.now();
  const { requestId, log } = requestLogger(await requestHeaders());
  const durationMs = () => Math.round(performance.now() - started);
  try {
    const result = (await body()) ?? { ok: true };
    log.debug({ durationMs: durationMs() }, "action.completed");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof DomainError) {
      log.info({ durationMs: durationMs(), code: error.code }, "action.rejected");
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    log.error({ err: error, durationMs: durationMs() }, "action.failed");
    return { ok: false, message: `Something went wrong on our side. Please try again. Reference: ${requestId}` };
  }
}

/** Logging must never break an action: outside a request (tests, scripts) a fresh ID is used instead. */
async function requestHeaders(): Promise<Headers> {
  try {
    return new Headers(await headers());
  } catch {
    return new Headers();
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
