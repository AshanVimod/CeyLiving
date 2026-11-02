import "server-only";
import { connection } from "next/server";
import { turnstileKeys } from "@/lib/env";
import { logger } from "./observability/logger";

// AU-06: Cloudflare Turnstile, checked on the server. The browser widget only hands the form a token; this asks
// Cloudflare whether the token is real, unused and for this site. A missing token, a refusal, or Cloudflare not
// answering in time all count as "not checked" (fail closed): the person can simply try again.

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The form field the widget fills in (Cloudflare's default name). */
export const TURNSTILE_FIELD = "cf-turnstile-response";

const TIMEOUT_MS = 5000;

/** The public site key for the widget, read per request (so a build never bakes in the key it happened to see). */
export async function turnstileSiteKey(): Promise<string> {
  await connection();
  return turnstileKeys().siteKey;
}

export async function verifyTurnstile(token: unknown, remoteIp?: string): Promise<boolean> {
  // Cloudflare's tokens are at most 2048 characters; anything else isn't worth a round trip.
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: turnstileKeys().secretKey, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
  try {
    const response = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn({ status: response.status }, "turnstile siteverify answered with an error status");
      return false;
    }
    const result = (await response.json()) as { success?: unknown; "error-codes"?: unknown };
    if (result.success === true) return true;
    logger.info({ errorCodes: result["error-codes"] }, "turnstile token refused");
    return false;
  } catch (err) {
    logger.warn({ err }, "turnstile siteverify unreachable");
    return false;
  }
}
