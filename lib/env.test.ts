// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  assertEmailConfig,
  assertFieldEncryptionConfig,
  EnvError,
  envSchema,
  FIELD_ENCRYPTION_DEV_KEY,
  fieldEncryptionKeys,
  getEnv,
  parseEnv,
  TURNSTILE_TEST_KEYS,
  turnstileKeys,
} from "./env";

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
  CACHE_REFRESH_SECRET: "r".repeat(40),
  PAYHERE_MERCHANT_ID: "1211149",
  PAYHERE_MERCHANT_SECRET: "p".repeat(40),
  STORAGE_DRIVER: "r2",
  R2_ACCOUNT_ID: "0123456789abcdef".repeat(2),
  R2_ACCESS_KEY_ID: "r2-access-key-placeholder",
  R2_SECRET_ACCESS_KEY: "s".repeat(40),
  R2_UPLOAD_BUCKET: "ceyliving-uploads",
  R2_PUBLIC_BUCKET: "ceyliving-images",
  NEXT_PUBLIC_IMAGE_BASE_URL: "https://img.ceyliving.lk",
};

describe("B11 field encryption key", () => {
  const randomKey = () => randomBytes(32).toString("base64");

  it("12.3 production refuses a missing FIELD_ENCRYPTION_KEY at web start", () => {
    const env = parseEnv(PROD);
    expect(problems(() => assertFieldEncryptionConfig(env))).toEqual([
      "FIELD_ENCRYPTION_KEY: is required in production (B11)",
    ]);
  });

  it("12.3 the worker's environment parses in production without the key", () => {
    expect(parseEnv(PROD).FIELD_ENCRYPTION_KEY).toBeUndefined();
  });

  it("12.3 production never falls back to the stand-in", () => {
    expect(() => fieldEncryptionKeys(parseEnv(PROD))).toThrow(EnvError);
    expect(fieldEncryptionKeys(parseEnv({ NODE_ENV: "development" })).current).toBe(FIELD_ENCRYPTION_DEV_KEY);
  });

  it("12.3 production refuses the stand-in and a weak key, in either variable", () => {
    const zeros = Buffer.alloc(32).toString("base64");
    for (const key of [FIELD_ENCRYPTION_DEV_KEY, zeros]) {
      expect(problems(() => parseEnv({ ...PROD, FIELD_ENCRYPTION_KEY: key }))[0]).toContain("FIELD_ENCRYPTION_KEY:");
      expect(
        problems(() =>
          parseEnv({ ...PROD, FIELD_ENCRYPTION_KEY: randomKey(), FIELD_ENCRYPTION_PREVIOUS_KEYS: key }),
        )[0],
      ).toContain("FIELD_ENCRYPTION_PREVIOUS_KEYS:");
    }
  });

  it("12.3 accepts a random key in production", () => {
    const key = randomKey();
    const env = parseEnv({ ...PROD, FIELD_ENCRYPTION_KEY: key });
    expect(fieldEncryptionKeys(env)).toEqual({ current: key, previous: [] });
  });

  it("12.3 a malformed or wrong-length key is refused, and the error shows no value", () => {
    const short = Buffer.alloc(16, "x").toString("base64");
    for (const bad of [short, "not base64 at all", `${randomKey()}x`]) {
      const found = problems(() => parseEnv({ FIELD_ENCRYPTION_KEY: bad }));
      expect(found[0]).toContain("must be 32 random bytes");
      expect(found.join()).not.toContain(bad);
    }
  });

  it("12.3 a previous key equal to the current key is refused", () => {
    const key = randomKey();
    expect(problems(() => parseEnv({ FIELD_ENCRYPTION_KEY: key, FIELD_ENCRYPTION_PREVIOUS_KEYS: key }))[0]).toContain(
      "must not contain the current",
    );
  });

  it("12.4 several previous keys are read from one comma-separated value", () => {
    const [a, b] = [randomKey(), randomKey()];
    const env = parseEnv({ FIELD_ENCRYPTION_PREVIOUS_KEYS: `${a}, ${b}` });
    expect(fieldEncryptionKeys(env).previous).toEqual([a, b]);
  });
});

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
      EMAIL_DRIVER: "smtp",
      EMAIL_FROM: "CeyLiving <no-reply@ceyliving.lk>",
      SITE_URL: "http://localhost:3000",
      WORKER_CONCURRENCY: 2,
      PAYHERE_MODE: "sandbox",
    });
  });

  it("B07 production needs CACHE_REFRESH_SECRET; elsewhere the catalogue refresh is optional", () => {
    expect(problems(() => parseEnv({ ...PROD, CACHE_REFRESH_SECRET: undefined }))).toEqual([
      "CACHE_REFRESH_SECRET: is required in production (B07)",
    ]);
    expect(problems(() => parseEnv({ CACHE_REFRESH_SECRET: "short" }))).toEqual([
      "CACHE_REFRESH_SECRET: must be at least 32 characters",
    ]);
    expect(parseEnv({ NODE_ENV: "development" }).CACHE_REFRESH_SECRET).toBeUndefined();
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

  it("B05a production needs a session secret of 32+ characters; SMTP_URL must be an SMTP address", () => {
    expect(problems(() => parseEnv({ ...PROD, BETTER_AUTH_SECRET: undefined, SMTP_URL: undefined }))).toEqual([
      "BETTER_AUTH_SECRET: is required in production (B05a)",
    ]);
    expect(problems(() => parseEnv({ BETTER_AUTH_SECRET: "too-short" }))).toEqual([
      "BETTER_AUTH_SECRET: must be at least 32 characters",
    ]);
    expect(problems(() => parseEnv({ SMTP_URL: "https://mail.example.net" }))).toEqual([
      "SMTP_URL: must be an smtp:// or smtps:// address",
    ]);
  });

  it("B10 the worker sends through Resend in production; the web app needs no email keys", () => {
    const worker = { ...PROD, EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_xxxxxxxxxxxx" };
    expect(() => assertEmailConfig(parseEnv(worker))).not.toThrow();
    // The web app's environment has no email keys at all, and still starts.
    expect(() => parseEnv({ ...PROD, SMTP_URL: undefined })).not.toThrow();
    expect(problems(() => assertEmailConfig(parseEnv({ ...PROD })))).toEqual([
      "EMAIL_DRIVER: must be resend in production (B10)",
    ]);
    expect(problems(() => assertEmailConfig(parseEnv({ ...PROD, EMAIL_DRIVER: "resend" })))).toEqual([
      "RESEND_API_KEY: is required when EMAIL_DRIVER=resend",
    ]);
    expect(problems(() => parseEnv({ RESEND_API_KEY: "sk_not_resend" }))).toEqual([
      "RESEND_API_KEY: must be a Resend API key (re_…)",
    ]);
    for (const from of ["CeyLiving <no-reply@example.com>", "dev@localhost", "CeyLiving <x@shop.invalid>"])
      expect(problems(() => assertEmailConfig(parseEnv({ ...worker, EMAIL_FROM: from })))).toEqual([
        "EMAIL_FROM: must be an address on a real domain",
      ]);
    // Outside production Mailpit is the default, and Resend is used only when chosen.
    expect(() => assertEmailConfig(parseEnv({ NODE_ENV: "development" }))).not.toThrow();
    const message = new EnvError(problems(() => parseEnv({ RESEND_API_KEY: "re_bad key!" }))).message;
    expect(message).not.toContain("bad key");
  });

  it("B06 WORKER_CONCURRENCY is a whole number from 1 to 20", () => {
    expect(parseEnv({ WORKER_CONCURRENCY: "5" }).WORKER_CONCURRENCY).toBe(5);
    for (const bad of ["0", "21", "2.5", "lots"])
      expect(problems(() => parseEnv({ WORKER_CONCURRENCY: bad }))[0]).toMatch(/^WORKER_CONCURRENCY:/);
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

  it("B08 PAY-02 production needs the PayHere merchant ID and secret; the API key comes as a pair", () => {
    expect(problems(() => parseEnv({ ...PROD, PAYHERE_MERCHANT_SECRET: undefined }))).toEqual([
      "PAYHERE_MERCHANT_SECRET: is required in production (B08)",
    ]);
    expect(problems(() => parseEnv({ PAYHERE_APP_ID: "app" }))).toEqual([
      "PAYHERE_APP_SECRET: set both PAYHERE_APP_ID and PAYHERE_APP_SECRET, or neither",
    ]);
  });

  it("12.3 an empty value counts as not set", () => {
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "", DATABASE_URL: "", SMTP_URL: "" })).toEqual({
      NODE_ENV: "development",
      ENABLE_DEMO_LOGIN: false,
      EMAIL_DRIVER: "smtp",
      EMAIL_FROM: "CeyLiving <no-reply@ceyliving.lk>",
      SITE_URL: "http://localhost:3000",
      WORKER_CONCURRENCY: 2,
      PAYHERE_MODE: "sandbox",
      STORAGE_DRIVER: "local",
      NEXT_PUBLIC_IMAGE_BASE_URL: "/dev-uploads",
    });
  });

  it("SEC-07 B09 production stores uploads in R2 and serves photos from an https image domain", () => {
    expect(
      problems(() => parseEnv({ ...PROD, STORAGE_DRIVER: "local", NEXT_PUBLIC_IMAGE_BASE_URL: undefined })),
    ).toEqual([
      "STORAGE_DRIVER: must be r2 in production (B09)",
      "NEXT_PUBLIC_IMAGE_BASE_URL: must be an https:// address in production (SEC-07)",
    ]);
    expect(problems(() => parseEnv({ ...PROD, R2_SECRET_ACCESS_KEY: undefined }))).toEqual([
      "R2_SECRET_ACCESS_KEY: is required when STORAGE_DRIVER=r2",
    ]);
    expect(problems(() => parseEnv({ ...PROD, R2_ACCOUNT_ID: "not-an-account" }))).toEqual([
      "R2_ACCOUNT_ID: must be the 32-character Cloudflare account id",
    ]);
    expect(parseEnv({ NEXT_PUBLIC_IMAGE_BASE_URL: "https://img.example.lk/" }).NEXT_PUBLIC_IMAGE_BASE_URL).toBe(
      "https://img.example.lk",
    );
    expect(parseEnv({}).STORAGE_DRIVER).toBe("local");
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
