import "server-only";
import { type Env, getEnv, ipHashKeyFrom } from "@/lib/env";

/** lib/env.ts requires a real secret in production; this fixed value only ever signs local development cookies. */
const DEVELOPMENT_SECRET = "ceyliving-local-development-secret-not-for-production";

/** The secret Better Auth signs with (B05a). */
export function authSecret(env: Env = getEnv()): string {
  return env.BETTER_AUTH_SECRET ?? DEVELOPMENT_SECRET;
}

/** 12.4 (B12): the key for IP hashes and Better Auth's stand-in addresses (IP_HASH_KEY). */
export function ipHashKey(env: Env = getEnv()): string {
  return ipHashKeyFrom(env);
}
