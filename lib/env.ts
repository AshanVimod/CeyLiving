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
    // B05a: where verification and password-reset emails go (smtp:// or smtps://). Required in production; locally
    // `npm run setup` points it at Mailpit. B10 moves email to the provider and the background worker.
    SMTP_URL: z.url({ protocol: /^smtps?$/, error: "must be an smtp:// or smtps:// address" }).optional(),
    EMAIL_FROM: z.string().min(3).default("CeyLiving <no-reply@ceyliving.lk>"),
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
    // OPS-01: log level. Default: info, or silent under NODE_ENV=test (see lib/server/observability/logger.ts).
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    // FR-2c: the site's public address, used for absolute links in sitemap.xml and robots.txt. No trailing slash.
    SITE_URL: z
      .url({ protocol: /^https?$/, error: "must be an http:// or https:// address" })
      .default("http://localhost:3000")
      .transform((url) => url.replace(/\/+$/, "")),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.ENABLE_DEMO_LOGIN) {
      ctx.addIssue({
        code: "custom",
        path: ["ENABLE_DEMO_LOGIN"],
        message: "must not be true when NODE_ENV=production (AU-09)",
      });
    }
    for (const key of ["BETTER_AUTH_SECRET", "SMTP_URL"] as const) {
      if (env.NODE_ENV === "production" && !env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required in production (B05a)" });
      }
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

/** Called once at server start (instrumentation.ts): a bad environment stops the app with a clear message. */
export function assertEnv(): void {
  getEnv();
}
