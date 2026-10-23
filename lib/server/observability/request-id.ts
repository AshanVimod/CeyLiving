// No "server-only" here: proxy.ts imports this file, and proxy can't import server-only modules.

/** Carries the request ID from proxy.ts to actions, route handlers and logs (OPS-02). */
export const REQUEST_ID_HEADER = "x-request-id";

// Cloudflare's Ray ID: 16 hex characters and a data-centre code, e.g. 8f3c1a2b4d5e6f70-CMB.
const CF_RAY = /^[0-9a-f]{16}-[A-Z]{3}$/;

/**
 * OPS-02: reuses Cloudflare's cf-ray when it is well formed, otherwise a new UUID.
 * A client-sent x-request-id is never trusted, so nobody can pick the ID their errors are logged under.
 */
export function resolveRequestId(headers: Headers): string {
  const ray = headers.get("cf-ray");
  return ray && CF_RAY.test(ray) ? ray : crypto.randomUUID();
}
