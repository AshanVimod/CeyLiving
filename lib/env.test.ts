// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EnvError, envSchema, getEnv, parseEnv, TURNSTILE_TEST_KEYS, turnstileKeys } from "./env";

afterEach(() => vi.unstubAllEnvs());

function problems(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("expected an EnvError");
}

const DB = "postgresql://ceyliving_app:x@db.internal:5432/ceyliving";
const SECRET = "s".repeat(40);
const SMTP = "smtps://mailer:x@smtp.example.net:465";
/** Everything production must have, so each test changes one thing. */
const SITE_KEY = "real-site-key-placeholder";
const TURNSTILE_SECRET = "real-secret-key-placeholder";
const PROD = {
  NODE_ENV: "production",
  DATABASE_URL: DB,
  BETTER_AUTH_SECRET: SECRET,
  SMTP_URL: SMTP,
  TURNSTILE_SITE_KEY: SITE_KEY,
  TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
};

describe("lib/env", () => {
  it("AU-09 refuses ENABLE_DEMO_LOGIN=true when NODE_ENV=production", () => {
    expect(problems(() => parseEnv({ ...PROD, ENABLE_DEMO_LOGIN: "true" }))).toEqual([
      "ENABLE_DEMO_LOGIN: must not be true when NODE_ENV=production (AU-09)",
    ]);
  });

  it("AU-09 allows ENABLE_DEMO_LOGIN=true in development", () => {
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "true" }).ENABLE_DEMO_LOGIN).toBe(true);
  });

  it("SEC-A8 production without ENABLE_DEMO_LOGIN parses with demo login off", () => {
    expect(parseEnv(PROD)).toEqual({
      ...PROD,
      ENABLE_DEMO_LOGIN: false,
      EMAIL_FROM: "CeyLiving <no-reply@ceyliving.lk>",
      SITE_URL: "http://localhost:3000",
    });
  });

  it("DB-10 production needs DATABASE_URL, and only a postgresql:// address", () => {
    expect(problems(() => parseEnv({ ...PROD, DATABASE_URL: undefined }))).toEqual([
      "DATABASE_URL: is required in production (DB-10)",
    ]);
    expect(problems(() => parseEnv({ DATABASE_URL: "mysql://db/ceyliving" }))).toEqual([
      "DATABASE_URL: must be a postgresql:// address",
    ]);
    expect(parseEnv({ NODE_ENV: "development" }).DATABASE_URL).toBeUndefined();
  });

  it("AU-06 production needs real Turnstile keys; elsewhere Cloudflare's test keys are used", () => {
    expect(
      problems(() => parseEnv({ ...PROD, TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined })),
    ).toEqual([
      "TURNSTILE_SITE_KEY: is required in production (AU-06)",
      "TURNSTILE_SECRET_KEY: is required in production (AU-06)",
    ]);
    expect(
      problems(() =>
        parseEnv({
          ...PROD,
          TURNSTILE_SITE_KEY: TURNSTILE_TEST_KEYS.siteKey,
          TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.secretKey,
        }),
      ),
    ).toEqual([
      "TURNSTILE_SITE_KEY: must not be a Cloudflare test key in production",
      "TURNSTILE_SECRET_KEY: must not be a Cloudflare test key in production",
    ]);
    expect(turnstileKeys(parseEnv({ NODE_ENV: "development" }))).toEqual(TURNSTILE_TEST_KEYS);
    expect(turnstileKeys(parseEnv(PROD))).toEqual({ siteKey: SITE_KEY, secretKey: TURNSTILE_SECRET });
  });

  it("B05a production needs a session secret of 32+ characters and an SMTP server for sign-in emails", () => {
    expect(problems(() => parseEnv({ ...PROD, BETTER_AUTH_SECRET: undefined, SMTP_URL: undefined }))).toEqual([
      "BETTER_AUTH_SECRET: is required in production (B05a)",
      "SMTP_URL: is required in production (B05a)",
    ]);
    expect(problems(() => parseEnv({ BETTER_AUTH_SECRET: "too-short" }))).toEqual([
      "BETTER_AUTH_SECRET: must be at least 32 characters",
    ]);
    expect(problems(() => parseEnv({ SMTP_URL: "https://mail.example.net" }))).toEqual([
      "SMTP_URL: must be an smtp:// or smtps:// address",
    ]);
  });

  it("OPS-01 accepts a known LOG_LEVEL and rejects anything else", () => {
    expect(parseEnv({ LOG_LEVEL: "debug" }).LOG_LEVEL).toBe("debug");
    expect(problems(() => parseEnv({ LOG_LEVEL: "verbose" }))[0]).toMatch(/^LOG_LEVEL:/);
  });

  it("A02/12.3 a missing or malformed value names the key and never echoes the value", () => {
    const withRequired = envSchema.and(z.object({ PAYHERE_MERCHANT_SECRET: z.string().min(1) }));
    const found = problems(() => parseEnv({ NODE_ENV: "staging-secret-x", ENABLE_DEMO_LOGIN: "yes" }, withRequired));
    expect(found).toContain("PAYHERE_MERCHANT_SECRET: is required");
    expect(found.some((p) => p.startsWith("NODE_ENV:"))).toBe(true);
    expect(found).toContain('ENABLE_DEMO_LOGIN: must be "true" or "false"');
    const message = new EnvError(found).message;
    expect(message).not.toContain("staging-secret-x");
    expect(message).not.toMatch(/\byes\b/);
  });

  it("12.3 an empty value counts as not set", () => {
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "", DATABASE_URL: "", SMTP_URL: "" })).toEqual({
      NODE_ENV: "development",
      ENABLE_DEMO_LOGIN: false,
      EMAIL_FROM: "CeyLiving <no-reply@ceyliving.lk>",
      SITE_URL: "http://localhost:3000",
    });
  });

  it("12.3 getEnv reads the current environment on every call", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEMO_LOGIN", "true");
    expect(getEnv().ENABLE_DEMO_LOGIN).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getEnv()).toThrow(EnvError);
  });

  it("FR-2c SITE_URL must be https:// in production, except on localhost", () => {
    expect(parseEnv({ ...PROD, SITE_URL: "https://ceyliving.lk/" }).SITE_URL).toBe("https://ceyliving.lk");
    expect(parseEnv({ ...PROD, SITE_URL: "http://localhost:3002" }).SITE_URL).toBe("http://localhost:3002");
    expect(problems(() => parseEnv({ ...PROD, SITE_URL: "http://ceyliving.lk" }))).toEqual([
      "SITE_URL: must be an https:// address in production",
    ]);
  });
});
