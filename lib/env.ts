import "server-only";
import { z } from "zod";

// 12.3: every environment variable the server reads is declared and checked here.
// Each backend task adds its own keys here and to .env.example (section 19).

const flag = z
  .enum(["true", "false"], { error: 'must be "true" or "false"' })
  .default("false")
  .transform((value) => value === "true");

/**
 * Cloudflare's published Turnstile test keys (developers.cloudflare.com/turnstile/troubleshooting/testing): this
 * pair always passes. Used in development and tests only; production refuses them.
 */
export const TURNSTILE_TEST_KEYS = {
  siteKey: "1x00000000000000000000AA",
  secretKey: "1x0000000000000000000000000000000AA",
};

/**
 * B08: stand-in PayHere merchant details for development and tests. They match no PayHere account, so only the
 * dev-only "Simulate payment" button can pay with them; production refuses them.
 */
export const PAYHERE_DEV_KEYS = {
  merchantId: "1200000",
  merchantSecret: "ceyliving-dev-only-payhere-merchant-secret",
};

/** B09: the local storage driver's dev-only route for processed photos (app/dev-uploads). */
export const DEV_IMAGE_BASE_URL = "/dev-uploads";

/**
 * B11 (12.4): the stand-in field encryption key for development and tests, built here so no key text is in the source.
 * Anything encrypted with it is readable by anyone with this code; production refuses it.
 */
export const FIELD_ENCRYPTION_DEV_KEY = Buffer.alloc(32, "ceyliving-dev").toString("base64");

/** 32 bytes in standard base64, written the one canonical way. */
function isFieldKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, "base64").toString("base64") === value;
}

/** A random 32-byte key has about 30 distinct byte values; repeated text, zeros and the stand-in have only a few. */
function isWeakFieldKey(value: string): boolean {
  return new Set(Buffer.from(value, "base64")).size < 16;
}

const fieldKey = z
  .string()
  .refine(isFieldKey, { error: "must be 32 random bytes in base64 (openssl rand -base64 32)" });

const R2_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_UPLOAD_BUCKET",
  "R2_PUBLIC_BUCKET",
] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // AU-09: development-only demo sign-in. Validated here; the session code uses it from B05.
    ENABLE_DEMO_LOGIN: flag,
    // DB-10: the app connects as ceyliving_app (data rights only). Required in production; `npm run setup` sets it.
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgresql:// address" }).optional(),
    // DB-10: migrations run as the schema owner, ceyliving_migrator. Read by the Prisma CLI (prisma.config.ts).
    DATABASE_MIGRATION_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgresql:// address" }).optional(),
    // B05a (AU-03): signs session cookies and email tokens. At least 32 characters; required in production.
    BETTER_AUTH_SECRET: z.string().min(32, { error: "must be at least 32 characters" }).optional(),
    // B10: how the worker sends email. `smtp` (default) sends to SMTP_URL: Mailpit locally, so nothing leaves the
    // computer. `resend` sends through Resend's API with RESEND_API_KEY; the worker requires it in production
    // (assertEmailConfig). The web app never sends email, so it needs neither.
    EMAIL_DRIVER: z.enum(["smtp", "resend"]).default("smtp"),
    // B05a/B10: Mailpit's SMTP address in development (`npm run setup` sets smtp://127.0.0.1:1025).
    SMTP_URL: z.url({ protocol: /^smtps?$/, error: "must be an smtp:// or smtps:// address" }).optional(),
    // B10: a Resend API key (send-only, limited to the sending domain). Worker only; never in logs or errors.
    RESEND_API_KEY: z
      .string()
      .regex(/^re_[A-Za-z0-9_]{8,200}$/, { error: "must be a Resend API key (re_…)" })
      .optional(),
    EMAIL_FROM: z.string().min(3).max(200).default("CeyLiving <no-reply@ceyliving.lk>"),
    // B11 (12.4): encrypts sellers' bank account numbers. 32 random bytes, base64. Web app and re-encrypt script only;
    // the worker never needs it. Required when the web app starts in production (assertFieldEncryptionConfig);
    // elsewhere it defaults to FIELD_ENCRYPTION_DEV_KEY. Never in logs, errors, the database or its backups.
    FIELD_ENCRYPTION_KEY: fieldKey.optional(),
    // B11: older keys, comma-separated, used only to decrypt during a rotation (README, "Bank details").
    FIELD_ENCRYPTION_PREVIOUS_KEYS: z
      .string()
      .transform((list) => list.split(",").map((key) => key.trim()))
      .pipe(z.array(fieldKey).max(5, { error: "can hold at most 5 keys" }))
      .optional(),
    // B05b (AU-06): Cloudflare Turnstile. Required in production; elsewhere they default to Cloudflare's published
    // test keys (TURNSTILE_TEST_KEYS), which always pass and never identify a real site.
    TURNSTILE_SITE_KEY: z.string().min(1).max(100).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).max(100).optional(),
    // B06: how many jobs of one queue the worker runs at the same time (1 to 20). Default 2.
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
    // B07: the worker asks the web app to drop its cached catalogue after an unpaid order's stock comes back
    // (POST /api/internal/catalogue-refresh). Both processes need the same secret: at least 32 characters, required
    // in production. Left unset elsewhere, the refresh is skipped and the cache catches up within its lifetime.
    CACHE_REFRESH_SECRET: z.string().min(32, { error: "must be at least 32 characters" }).optional(),
    // B07: where the worker reaches the web app, e.g. http://web:3000 inside Docker. Default: SITE_URL.
    INTERNAL_APP_URL: z
      .url({ protocol: /^https?$/, error: "must be an http:// or https:// address" })
      .optional()
      .transform((url) => url?.replace(/\/+$/, "")),
    // B08 (PAY-02): PayHere merchant details (PayHere account > Integrations). The secret is per domain and stays on
    // the server: it never reaches client code, logs or error messages. Required in production; elsewhere they
    // default to PAYHERE_DEV_KEYS, which only the dev "Simulate payment" button can use.
    PAYHERE_MERCHANT_ID: z
      .string()
      .regex(/^\d{1,20}$/, { error: "must be the numeric merchant ID" })
      .optional(),
    PAYHERE_MERCHANT_SECRET: z.string().min(8).max(200).optional(),
    // B08: sandbox (default) sends customers to sandbox.payhere.lk; live to www.payhere.lk.
    PAYHERE_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    // B08 (PAY-07, PAY-08): optional Merchant API key (Settings > API Keys) for refunds through PayHere and the daily
    // reconciliation. Without them, refunds are recorded by hand and reconciliation is skipped.
    PAYHERE_APP_ID: z.string().min(1).max(200).optional(),
    PAYHERE_APP_SECRET: z.string().min(1).max(200).optional(),
    // B08: where PayHere sends payment notifications. Default: SITE_URL + /api/payments/payhere/notify. In
    // development, a public tunnel's address (PayHere can't reach localhost).
    PAYHERE_NOTIFY_URL: z.url({ protocol: /^https?$/, error: "must be an http:// or https:// address" }).optional(),
    // B09 (SEC-07, backend plan 11.1): where uploaded photos are kept. `local` (default) writes to .data/uploads/
    // and serves them through dev-only routes; production must use `r2`.
    STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
    // B09: where the local driver keeps files. Default .data/uploads (git-ignored). Tests use a temporary folder.
    LOCAL_UPLOADS_DIR: z.string().min(1).optional(),
    // B09: Cloudflare R2 (account id, an API token's S3 keys, and two buckets). R2_UPLOAD_BUCKET is private and holds
    // originals (they can carry GPS data) and application photos; R2_PUBLIC_BUCKET holds the processed sizes and is
    // served at NEXT_PUBLIC_IMAGE_BASE_URL. All required when STORAGE_DRIVER=r2.
    R2_ACCOUNT_ID: z
      .string()
      .regex(/^[a-f0-9]{32}$/, { error: "must be the 32-character Cloudflare account id" })
      .optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).max(200).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).max(200).optional(),
    R2_UPLOAD_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { error: "must be an R2 bucket name" })
      .optional(),
    R2_PUBLIC_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, { error: "must be an R2 bucket name" })
      .optional(),
    // B09 (SEC-07): where processed photos are served from, e.g. https://img.ceyliving.lk. Read by browser code too
    // (inlined at build time). Default /dev-uploads, the dev-only route of the local driver. No trailing slash.
    NEXT_PUBLIC_IMAGE_BASE_URL: z
      .string()
      .regex(/^(https?:\/\/[^/\s]+|\/[a-z0-9-]+)(\/[a-z0-9-]+)*\/?$/i, {
        error: "must be an http(s):// address or a path like /dev-uploads",
      })
      .default(DEV_IMAGE_BASE_URL)
      .transform((url) => url.replace(/\/+$/, "")),
    // OPS-01: log level. Default: info, or silent under NODE_ENV=test (see lib/server/observability/logger.ts).
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    // FR-2c: the site's public address, used for absolute links in sitemap.xml and robots.txt. No trailing slash.
    SITE_URL: z
      .url({ protocol: /^https?$/, error: "must be an http:// or https:// address" })
      .default("http://localhost:3000")
      .transform((url) => url.replace(/\/+$/, "")),
  })
  .superRefine((env, ctx) => {
    if (env.FIELD_ENCRYPTION_KEY && env.FIELD_ENCRYPTION_PREVIOUS_KEYS?.includes(env.FIELD_ENCRYPTION_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["FIELD_ENCRYPTION_PREVIOUS_KEYS"],
        message: "must not contain the current FIELD_ENCRYPTION_KEY",
      });
    }
    if (env.NODE_ENV === "production") {
      const keys = [
        ["FIELD_ENCRYPTION_KEY", env.FIELD_ENCRYPTION_KEY],
        ...(env.FIELD_ENCRYPTION_PREVIOUS_KEYS ?? []).map((key) => ["FIELD_ENCRYPTION_PREVIOUS_KEYS", key] as const),
      ] as const;
      for (const [name, key] of keys) {
        if (key && isWeakFieldKey(key)) {
          ctx.addIssue({ code: "custom", path: [name], message: "must be randomly generated, not a stand-in (B11)" });
        }
      }
    }
    if (env.NODE_ENV === "production" && env.ENABLE_DEMO_LOGIN) {
      ctx.addIssue({
        code: "custom",
        path: ["ENABLE_DEMO_LOGIN"],
        message: "must not be true when NODE_ENV=production (AU-09)",
      });
    }
    if (env.NODE_ENV === "production" && !env.BETTER_AUTH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "is required in production (B05a)" });
    }
    if (env.NODE_ENV === "production" && !env.CACHE_REFRESH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["CACHE_REFRESH_SECRET"], message: "is required in production (B07)" });
    }
    for (const key of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"] as const) {
      if (env.NODE_ENV !== "production") continue;
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required in production (AU-06)" });
      else if (Object.values(TURNSTILE_TEST_KEYS).includes(env[key])) {
        ctx.addIssue({ code: "custom", path: [key], message: "must not be a Cloudflare test key in production" });
      }
    }
    for (const key of ["PAYHERE_MERCHANT_ID", "PAYHERE_MERCHANT_SECRET"] as const) {
      if (env.NODE_ENV !== "production") continue;
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required in production (B08)" });
      else if (Object.values(PAYHERE_DEV_KEYS).includes(env[key])) {
        ctx.addIssue({ code: "custom", path: [key], message: "must not be the development stand-in in production" });
      }
    }
    if (Boolean(env.PAYHERE_APP_ID) !== Boolean(env.PAYHERE_APP_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYHERE_APP_SECRET"],
        message: "set both PAYHERE_APP_ID and PAYHERE_APP_SECRET, or neither",
      });
    }
    if (env.NODE_ENV === "production" && env.STORAGE_DRIVER === "local") {
      ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "must be r2 in production (B09)" });
    }
    if (env.STORAGE_DRIVER === "r2") {
      for (const key of R2_KEYS) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required when STORAGE_DRIVER=r2" });
      }
      if (!/^https?:\/\//.test(env.NEXT_PUBLIC_IMAGE_BASE_URL)) {
        ctx.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_IMAGE_BASE_URL"],
          message: "must be the public bucket's address when STORAGE_DRIVER=r2",
        });
      }
    }
    if (env.NODE_ENV === "production" && !env.NEXT_PUBLIC_IMAGE_BASE_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_IMAGE_BASE_URL"],
        message: "must be an https:// address in production (SEC-07)",
      });
    }
    if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
      ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "is required in production (DB-10)" });
    }
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.SITE_URL);
    if (env.NODE_ENV === "production" && !env.SITE_URL.startsWith("https://") && !local) {
      ctx.addIssue({ code: "custom", path: ["SITE_URL"], message: "must be an https:// address in production" });
    }
  });

export type Env = z.output<typeof envSchema>;

/** AU-06: the Turnstile keys in use (the test pair outside production when none are set). */
export function turnstileKeys(env: Env = getEnv()): { siteKey: string; secretKey: string } {
  return {
    siteKey: env.TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_KEYS.siteKey,
    secretKey: env.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_KEYS.secretKey,
  };
}

/** B11: the field encryption keys in use (the stand-in outside production when none is set). Production never falls back. */
export function fieldEncryptionKeys(env: Env = getEnv()): { current: string; previous: string[] } {
  if (env.NODE_ENV === "production" && !env.FIELD_ENCRYPTION_KEY) {
    throw new EnvError(["FIELD_ENCRYPTION_KEY: is required in production (B11)"]);
  }
  return {
    current: env.FIELD_ENCRYPTION_KEY ?? FIELD_ENCRYPTION_DEV_KEY,
    previous: env.FIELD_ENCRYPTION_PREVIOUS_KEYS ?? [],
  };
}

/** Lists each bad key and why; never the value, so secrets can't reach logs. */
export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\nSee .env.example.`);
    this.name = "EnvError";
  }
}

type Source = Record<string, string | undefined>;

export function parseEnv<S extends z.ZodType = typeof envSchema>(source: Source, schema?: S): z.output<S> {
  // An empty value (KEY= in a .env file) counts as not set.
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = (schema ?? envSchema).safeParse(present);
  if (result.success) return result.data as z.output<S>;
  throw new EnvError(
    result.error.issues.map((issue) => {
      const key = issue.path.join(".") || "(environment)";
      return issue.code === "invalid_type" && issue.input === undefined
        ? `${key}: is required`
        : `${key}: ${issue.message}`;
    }),
  );
}

/** Reads process.env on every call (no cache), so tests that stub variables see the change. */
export function getEnv(): Env {
  return parseEnv(process.env);
}

/** The sender address domains production refuses (B10): they can't be verified with Resend. */
const TEST_SENDER = /@(localhost|example\.(com|org|net)|[^>\s]*\.(invalid|test|local|localhost))>?\s*$/i;

/**
 * B10: called when the worker starts, the only process that sends email. Production must send through Resend with
 * a key and a real sender; the web app doesn't send and doesn't need these. Outside production, Mailpit (smtp) is the
 * default and Resend is used only when chosen. Lists problems by key, never values.
 */
export function assertEmailConfig(env: Env = getEnv()): void {
  const problems: string[] = [];
  if (env.EMAIL_DRIVER === "resend" && !env.RESEND_API_KEY) {
    problems.push("RESEND_API_KEY: is required when EMAIL_DRIVER=resend");
  }
  if (env.NODE_ENV === "production") {
    if (env.EMAIL_DRIVER !== "resend") problems.push("EMAIL_DRIVER: must be resend in production (B10)");
    if (TEST_SENDER.test(env.EMAIL_FROM)) problems.push("EMAIL_FROM: must be an address on a real domain");
  }
  if (problems.length) throw new EnvError(problems);
}

/**
 * B11: called when the web app starts and by the re-encrypt script, the only code that uses the key. The worker never
 * encrypts or decrypts, so it doesn't call this and doesn't hold the key.
 */
export function assertFieldEncryptionConfig(env: Env = getEnv()): void {
  fieldEncryptionKeys(env);
}

/** Called once at server start (instrumentation.ts): a bad environment stops the app with a clear message. */
export function assertEnv(): void {
  assertFieldEncryptionConfig(getEnv());
}
