import "server-only";
import { type Env, getEnv } from "@/lib/env";

/**
 * 12.2 (B12): a state-changing request from a browser must come from our own site. The Origin header must be present
 * and be exactly SITE_URL's origin. Outside production the request's own host is accepted too, because development
 * runs on other ports than SITE_URL. Browsers always send Origin on POST, PUT, PATCH and DELETE, so a missing one is
 * refused.
 */
export function isAllowedOrigin(requestHeaders: Headers, requestUrl: string, env: Env = getEnv()): boolean {
  const origin = requestHeaders.get("origin");
  if (!origin || origin === "null") return false;
  if (origin === new URL(env.SITE_URL).origin) return true;
  if (env.NODE_ENV === "production") return false;
  const host = requestHeaders.get("host");
  return host !== null && origin === `${new URL(requestUrl).protocol}//${host}`;
}
