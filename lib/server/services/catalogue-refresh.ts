import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Logger } from "pino";
import { PUBLIC_PAGES } from "@/lib/config";
import { categories } from "@/lib/data/categories";
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

/** How long a starting web app keeps trying to expire its build-time catalogue before it gives up and exits. */
export const START_REFRESH_DEADLINE_MS = 60_000;

/**
 * The pages a starting web app requests once after expiring the catalogue: the sitemap and the pages that list items.
 * Next serves a page prerendered at build time once more after it expired (then renders it fresh), so these requests
 * take that stale copy instead of a visitor. Item and shop pages need none: the image's build had no items or shops.
 */
export function startWarmPaths(): string[] {
  return ["/sitemap.xml", ...PUBLIC_PAGES, ...categories.map((c) => `/c/${c.slug}`)];
}

/**
 * B14 (BE-09): `next build` prerenders catalogue pages from the build's database, and a started or restarted server
 * would serve those until their cache life runs out. Images are built from an empty catalogue (staticSlugParams), and
 * as soon as the server listens it asks its own refresh route to expire the whole catalogue (every cached read carries
 * CATALOGUE_TAG), then requests the list pages once (startWarmPaths). Production only; the address is this process,
 * never the public site. Gives up after `deadlineMs` and returns "failed": the caller then exits, so Docker restarts
 * the container. A list page that fails to load is logged and left for the first visitor.
 */
export async function expireBuildCatalogue(
  log: Logger,
  {
    env = getEnv(),
    port = process.env.PORT ?? "3000",
    send = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    deadlineMs = START_REFRESH_DEADLINE_MS,
    intervalMs = 500,
  }: {
    env?: Env;
    port?: string;
    send?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    deadlineMs?: number;
    intervalMs?: number;
  } = {},
): Promise<"refreshed" | "skipped" | "failed"> {
  if (env.NODE_ENV !== "production" || !env.CACHE_REFRESH_SECRET) return "skipped";
  const url = `http://127.0.0.1:${port}${CATALOGUE_REFRESH_PATH}`;
  const started = now();
  let attempts = 0;
  let last = "";
  while (now() - started < deadlineMs) {
    attempts += 1;
    try {
      const response = await send(url, {
        method: "POST",
        headers: { authorization: `Bearer ${env.CACHE_REFRESH_SECRET}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 204) {
        const warmed = await warmPaths(`http://127.0.0.1:${port}`, startWarmPaths(), send);
        log.info(
          { attempts, warmed: warmed.ok, warmFailed: warmed.failed, ms: now() - started },
          "catalogue.start_refresh",
        );
        return "refreshed";
      }
      last = `answered ${response.status}`;
    } catch (error) {
      // Not listening yet (ECONNREFUSED) is the usual case for the first few tries.
      last = error instanceof Error ? error.name : "error";
    }
    await sleep(intervalMs);
  }
  log.fatal({ attempts, last }, "catalogue.start_refresh_failed");
  return "failed";
}

/** Requests each path once, one at a time, reading the whole page. Returns how many answered 200 and which didn't. */
async function warmPaths(origin: string, paths: string[], send: typeof fetch) {
  let ok = 0;
  const failed: string[] = [];
  for (const path of paths) {
    try {
      const response = await send(`${origin}${path}`, { signal: AbortSignal.timeout(30_000) });
      await response.arrayBuffer();
      if (response.ok) ok += 1;
      else failed.push(`${path} ${response.status}`);
    } catch (error) {
      failed.push(`${path} ${error instanceof Error ? error.name : "error"}`);
    }
  }
  return { ok, failed };
}

/** The route's check: the bearer secret matches, compared in constant time. False when no secret is configured. */
export function isCatalogueRefreshAllowed(authorization: string | null, env: Env = getEnv()): boolean {
  const secret = env.CACHE_REFRESH_SECRET;
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(authorization.slice("Bearer ".length)), digest(secret));
}
