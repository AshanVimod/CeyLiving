import "server-only";
import { createHmac } from "node:crypto";
import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { ipHashKey } from "./auth-secret";

/** What `clientIp` answers when no proxy header names the visitor. All such requests count as one visitor (AU-06). */
export const UNKNOWN_IP = "unknown";

/** The visitor's address as Cloudflare (or the proxy in front) reports it. Kept in memory only, never stored. */
export function clientIp(requestHeaders: Headers): string {
  return (
    requestHeaders.get("cf-connecting-ip") ?? requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? UNKNOWN_IP
  );
}

/**
 * 12.4 / OPS-02: the only form in which an IP is stored (rate-limit keys, audit rows). A keyed hash, so the same IP
 * always gives the same value (limits and investigations still work) but the address can't be read back or guessed
 * by hashing every IP without the key (IP_HASH_KEY). 32 hex characters. `unknown` stays as it is, so it remains one
 * shared key.
 */
export function ipHash(ip: string, key: string = ipHashKey()): string {
  if (ip === UNKNOWN_IP) return UNKNOWN_IP;
  return createHmac("sha256", key).update(`ip-hash:${ip}`).digest("hex").slice(0, 32);
}

// --- Better Auth's own rate limiter (12.4, AU-06) ---------------------------------------------------------------------
//
// Better Auth keys its limiter rows (`rate_limits.key`) as `<ip>|<path>`, with the IP as it read it, and has no option
// to hash it. Swapping its storage would replace its atomic check-and-count, so instead the /api/auth route hands it a
// stand-in address: a keyed hash of the visitor's IP, shaped as an IPv6 address so Better Auth accepts it and counts
// exactly as it does for a real one. Docs: README, "IP addresses".

/** The only header Better Auth reads an IP from (`advanced.ipAddress.ipAddressHeaders`). Set by the server only. */
export const RATE_LIMIT_IP_HEADER = "x-ceyliving-rl-ip";

/** The proxy headers that may name the visitor, in the order Better Auth used to read them (B05a). */
const FORWARDED_IP_HEADERS = ["cf-connecting-ip", "x-forwarded-for"] as const;

/**
 * The visitor's IP by Better Auth's own rules, so the change trusts nothing it didn't: the first header that holds a
 * valid address, and `x-forwarded-for` only when it names a single address (a chain's left end can be forged).
 * Normalised as Better Auth does: IPv4-mapped IPv6 becomes IPv4, other IPv6 is cut to its /64 network. `null` when
 * no header names a valid address.
 */
export function trustedClientIp(requestHeaders: Headers): string | null {
  for (const name of FORWARDED_IP_HEADERS) {
    const value = requestHeaders.get(name);
    if (value === null) continue;
    const ip = getIPFromHeader(value);
    if (ip) return ip;
  }
  return null;
}

/**
 * A stand-in IPv6 address for a normalised IP: `fd` and 56 bits of an HMAC under IP_HASH_KEY, in the top 64 bits
 * (Better Auth keeps those and zeroes the rest). The same IP and key always give the same address; without the key
 * it can't be traced back. A different label from `ipHash`, so the two values can't be matched with each other.
 */
export function rateLimitPseudonym(ip: string, key: string = ipHashKey()): string {
  const hex = createHmac("sha256", key).update(`rate-limit-ip:${ip}`).digest("hex");
  return `fd${hex.slice(0, 2)}:${hex.slice(2, 6)}:${hex.slice(6, 10)}:${hex.slice(10, 14)}::`;
}

/**
 * The request Better Auth's handler gets: every proxy IP header removed, including any copy of ours a client sent,
 * and ours set to the stand-in. With no trusted IP, none is set, and Better Auth puts the request in its shared
 * "no trusted IP" bucket as before (in development and tests it uses 127.0.0.1 instead).
 */
export function withRateLimitPseudonym(request: Request): Request {
  const headers = new Headers(request.headers);
  const ip = trustedClientIp(headers);
  for (const name of [...FORWARDED_IP_HEADERS, RATE_LIMIT_IP_HEADER]) headers.delete(name);
  if (ip) headers.set(RATE_LIMIT_IP_HEADER, rateLimitPseudonym(ip));
  return new Request(request, { headers });
}
