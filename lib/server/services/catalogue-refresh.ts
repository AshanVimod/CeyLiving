import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Logger } from "pino";
import { getEnv, type Env } from "@/lib/env";
import type { Tx } from "../db/tx";
import { enqueue } from "../repositories/jobs";

// B07: the public catalogue (stock included) is cached inside the web app, and only the web app can expire it
// (revalidateTag works in route handlers and server actions). When a worker job gives stock back, the
// catalogue.refresh job calls the web app's internal route with a shared secret. If the web app is down, the job
// fails and pg-boss retries it (JOB-04). Checkout itself always reads stock from the database.

export const CATALOGUE_REFRESH_PATH = "/api/internal/catalogue-refresh";

/**
 * Queues the whole-catalogue refresh in the caller's transaction (JOB-02: only if the change commits). For changes
 * made where updateTag can't run (the worker), or ones too wide to tag (a shop going live). One job at a time
 * (singletonKey), so a burst of changes refreshes once.
 */
export async function queueCatalogueRefresh(tx: Tx): Promise<void> {
  await enqueue(tx, "catalogue.refresh", {}, { singletonKey: "catalogue" });
}

/** Calls the web app's refresh route. Returns "refreshed", or "skipped" when no secret is set (development only). */
export async function requestCatalogueRefresh(
  log: Logger,
  env: Env = getEnv(),
  send: typeof fetch = fetch,
): Promise<"refreshed" | "skipped"> {
  if (!env.CACHE_REFRESH_SECRET) {
    log.info("catalogue.refresh_skipped: CACHE_REFRESH_SECRET is not set; the cache catches up within its lifetime");
    return "skipped";
  }
  const url = `${env.INTERNAL_APP_URL ?? env.SITE_URL}${CATALOGUE_REFRESH_PATH}`;
  const response = await send(url, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CACHE_REFRESH_SECRET}` },
    signal: AbortSignal.timeout(10_000),
  });
  // The status only: never the response body or the secret.
  if (!response.ok) throw new Error(`Catalogue refresh failed: ${CATALOGUE_REFRESH_PATH} answered ${response.status}`);
  return "refreshed";
}

/** The route's check: the bearer secret matches, compared in constant time. False when no secret is configured. */
export function isCatalogueRefreshAllowed(authorization: string | null, env: Env = getEnv()): boolean {
  const secret = env.CACHE_REFRESH_SECRET;
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(authorization.slice("Bearer ".length)), digest(secret));
}
