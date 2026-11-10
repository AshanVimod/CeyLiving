// @vitest-environment node
import { isIP } from "node:net";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migratorClient, withTestDatabase } from "@/test/db";

// B12 (backend plan 12.4, AU-06): Better Auth's own limiter counts by a keyed stand-in address, never the visitor's
// IP. Its limiter is off under NODE_ENV=test for every other test, so this file gives the /api/auth route an instance
// with it on, built by the same createAuth as production. Its rules, storage and counting are the real ones.

vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => undefined }));
vi.mock("@/lib/server/better-auth", async (original) => {
  const real = await original<typeof import("@/lib/server/better-auth")>();
  const { appPrisma } = await import("@/lib/server/db/tx");
  let limited: { prisma: unknown; auth: ReturnType<typeof real.createAuth> } | undefined;
  return {
    ...real,
    getAuth: () => {
      const prisma = appPrisma();
      if (limited?.prisma !== prisma) limited = { prisma, auth: real.createAuth(prisma, { rateLimit: true }) };
      return limited.auth;
    },
  };
});

const { POST } = await import("@/app/api/auth/[...all]/route");
const { RATE_LIMIT_IP_HEADER, rateLimitPseudonym, trustedClientIp, withRateLimitPseudonym } = await import("./ip");
const { AUTH_ATTEMPTS } = await import("@/lib/server/better-auth");
const { pruneRateLimitRows, RATE_LIMIT_ROW_RETENTION_MS } = await import("@/lib/server/services/maintenance");
const { IP_HASH_DEV_KEY, parseEnv } = await import("@/lib/env");

withTestDatabase();

const SITE = "http://localhost:3000";

beforeEach(async () => {
  await migratorClient().$executeRawUnsafe("DELETE FROM rate_limits");
});
afterEach(() => vi.unstubAllEnvs());

/** A sign-in straight to Better Auth's route, as a script would send it. Turnstile is missing, so it answers 400. */
function signIn(headers: Record<string, string>, email = "nobody@example.lk") {
  return POST(
    new NextRequest(`${SITE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE, ...headers },
      body: JSON.stringify({ email, password: "not-the-password" }),
    }),
  );
}

const statuses = async (requests: Promise<Response>[]) => (await Promise.all(requests)).map((r) => r.status);
const keys = async () => (await migratorClient().rateLimit.findMany({ select: { key: true } })).map((r) => r.key);

describe("12.4 the stand-in address", () => {
  it("is a valid IPv6 address, the same for the same IP and key, different for another IP or key", () => {
    const a = rateLimitPseudonym("203.0.113.7", "k".repeat(32));
    expect(isIP(a)).toBe(6);
    expect(a).toMatch(/^fd[0-9a-f]{2}(:[0-9a-f]{4}){3}::$/);
    expect(rateLimitPseudonym("203.0.113.7", "k".repeat(32))).toBe(a);
    expect(rateLimitPseudonym("203.0.113.8", "k".repeat(32))).not.toBe(a);
    expect(rateLimitPseudonym("203.0.113.7", "j".repeat(32))).not.toBe(a); // a new key starts every limit over
    expect(a).not.toContain("203");
  });

  it("follows Better Auth's rules for which IP to trust, and how to group IPv6", () => {
    const ip = (headers: Record<string, string>) => trustedClientIp(new Headers(headers));
    expect(ip({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })).toBe("203.0.113.7");
    expect(ip({ "x-forwarded-for": "198.51.100.1" })).toBe("198.51.100.1");
    expect(ip({ "x-forwarded-for": "6.6.6.6, 198.51.100.1" })).toBeNull(); // a chain's left end can be forged
    expect(ip({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "198.51.100.1" })).toBe("198.51.100.1");
    expect(ip({ "cf-connecting-ip": "::ffff:203.0.113.7" })).toBe("203.0.113.7");
    expect(ip({})).toBeNull();
    // One /64 network is one visitor, as Better Auth counts it; another network is another.
    expect(ip({ "cf-connecting-ip": "2001:db8:1:2::a" })).toBe(ip({ "cf-connecting-ip": "2001:db8:1:2:ffff::1" }));
    expect(ip({ "cf-connecting-ip": "2001:db8:1:2::a" })).not.toBe(ip({ "cf-connecting-ip": "2001:db8:1:3::a" }));
  });

  it("replaces every proxy header, and a client's own copy of ours, with the stand-in alone", () => {
    const out = withRateLimitPseudonym(
      new Request(`${SITE}/api/auth/get-session`, {
        headers: { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7", [RATE_LIMIT_IP_HEADER]: "::1" },
      }),
    );
    expect(out.headers.get("cf-connecting-ip")).toBeNull();
    expect(out.headers.get("x-forwarded-for")).toBeNull();
    expect(out.headers.get(RATE_LIMIT_IP_HEADER)).toBe(rateLimitPseudonym("203.0.113.7"));
    const none = withRateLimitPseudonym(new Request(SITE, { headers: { [RATE_LIMIT_IP_HEADER]: "fd00::" } }));
    expect(none.headers.get(RATE_LIMIT_IP_HEADER)).toBeNull();
  });
});

describe("AU-06 / 12.4 Better Auth's limiter on /api/auth, counting by the stand-in", () => {
  it("allows 5 sign-ins per IP, refuses the 6th with 429, and stores no raw IP", async () => {
    const results = [];
    for (let i = 0; i < AUTH_ATTEMPTS.max + 1; i++)
      results.push((await signIn({ "cf-connecting-ip": "203.0.113.7" })).status);
    expect(results.slice(0, AUTH_ATTEMPTS.max).every((s) => s !== 429)).toBe(true);
    expect(results.at(-1)).toBe(429);
    const stored = await keys();
    // Better Auth writes the stand-in in full: its 64 hashed bits, then the zeroed rest.
    expect(stored).toEqual([
      `${rateLimitPseudonym("203.0.113.7").replace("::", ":0000:0000:0000:0000")}|/sign-in/email`,
    ]);
    expect(JSON.stringify(stored)).not.toContain("203.0.113.7");
  });

  it("keeps counting the same IP whatever stand-in or forwarded chain the client sends", async () => {
    for (let i = 0; i < AUTH_ATTEMPTS.max; i++) await signIn({ "cf-connecting-ip": "203.0.113.7" });
    const spoofed = await statuses([
      signIn({ "cf-connecting-ip": "203.0.113.7", [RATE_LIMIT_IP_HEADER]: "fd11:2222:3333:4444::" }),
      signIn({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" }),
    ]);
    expect(spoofed).toEqual([429, 429]);
    expect((await keys()).some((k) => k.startsWith("fd11:2222"))).toBe(false);
  });

  it("gives another IP its own count", async () => {
    for (let i = 0; i < AUTH_ATTEMPTS.max + 1; i++) await signIn({ "cf-connecting-ip": "203.0.113.7" });
    expect((await signIn({ "cf-connecting-ip": "198.51.100.20" })).status).not.toBe(429);
  });

  it("still lets exactly 5 of 10 simultaneous sign-ins through (Better Auth's atomic count is unchanged)", async () => {
    const results = await statuses(Array.from({ length: 10 }, () => signIn({ "cf-connecting-ip": "192.0.2.44" })));
    expect(results.filter((s) => s !== 429)).toHaveLength(AUTH_ATTEMPTS.max);
    expect(results.filter((s) => s === 429)).toHaveLength(10 - AUTH_ATTEMPTS.max);
  });

  it("ignores a stand-in sent with no trusted IP: the request falls into the shared bucket, as before", async () => {
    await signIn({ [RATE_LIMIT_IP_HEADER]: "fd11:2222:3333:4444::" });
    expect(await keys()).toEqual(["127.0.0.1|/sign-in/email"]); // Better Auth's development and test fallback
  });
});

describe("12.4 retention: rateLimits.prune", () => {
  it("deletes rows an hour after their window started, ours and Better Auth's; newer rows stay", async () => {
    const now = Date.now();
    const old = BigInt(now - RATE_LIMIT_ROW_RETENTION_MS - 1);
    await migratorClient().rateLimit.createMany({
      data: [
        { id: "rl_old_ours", key: "ceyliving:sign-in:ip:abc", count: 3, lastRequest: old },
        { id: "rl_old_theirs", key: "fd12:3456:789a:bcde::|/sign-in/email", count: 2, lastRequest: old },
        { id: "rl_recent", key: "fd12:3456:789a:bcdf::|/sign-in/email", count: 1, lastRequest: BigInt(now - 60_000) },
      ],
    });
    expect(await pruneRateLimitRows(new Date(now))).toBe(2);
    expect(await pruneRateLimitRows(new Date(now))).toBe(0); // JOB-03: running again deletes nothing more
    expect(await keys()).toEqual(["fd12:3456:789a:bcdf::|/sign-in/email"]);
  });
});

describe("12.4 IP_HASH_KEY", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app@db/ceyliving",
    BETTER_AUTH_SECRET: "a".repeat(40),
    CACHE_REFRESH_SECRET: "b".repeat(40),
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
    PAYHERE_MERCHANT_ID: "1000000",
    PAYHERE_MERCHANT_SECRET: "c".repeat(20),
    STORAGE_DRIVER: "r2",
    R2_ACCOUNT_ID: "0".repeat(32),
    R2_ACCESS_KEY_ID: "id",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_UPLOAD_BUCKET: "uploads",
    R2_PUBLIC_BUCKET: "images",
    NEXT_PUBLIC_IMAGE_BASE_URL: "https://img.example.lk",
    SITE_URL: "https://ceyliving.lk",
  };

  it("is required when the site starts in production, and must be its own value", async () => {
    const { assertIpHashConfig, EnvError } = await import("@/lib/env");
    expect(() => assertIpHashConfig(parseEnv(production))).toThrow(EnvError);
    expect(() => assertIpHashConfig(parseEnv({ ...production, IP_HASH_KEY: "d".repeat(40) }))).not.toThrow();
    expect(() => parseEnv({ ...production, IP_HASH_KEY: production.BETTER_AUTH_SECRET })).toThrow(/IP_HASH_KEY/);
    expect(() => parseEnv({ ...production, IP_HASH_KEY: IP_HASH_DEV_KEY })).toThrow(/IP_HASH_KEY/);
    expect(() => parseEnv({ ...production, IP_HASH_KEY: "short" })).toThrow(/IP_HASH_KEY/);
  });
});
