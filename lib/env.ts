import "server-only";
import { z } from "zod";

// 12.3: every environment variable the server reads is declared and checked here.
// Each backend task adds its own keys here and to .env.example (section 19).

const flag = z
  .enum(["true", "false"], { error: 'must be "true" or "false"' })
  .default("false")
  .transform((value) => value === "true");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // AU-09: development-only demo sign-in. Validated here; the session code uses it from B05.
    ENABLE_DEMO_LOGIN: flag,
    // Dev store file (feature spec 7.4); tests point it at a temp file.
    CEYLIVING_STORE_PATH: z.string().min(1).optional(),
    // OPS-01: log level. Default: info, or silent under NODE_ENV=test (see lib/server/observability/logger.ts).
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    // Feature-02 public demo: in-memory store, demo sign-in, banner and noindex, even in production.
    // A separate, deliberate switch from ENABLE_DEMO_LOGIN, which AU-09 keeps out of production.
    DEMO_MODE: flag,
    // Feature-02: the external form the demo banner links to. Ignored unless DEMO_MODE=true.
    FEEDBACK_URL: z.url({ protocol: /^https$/, error: "must be an https:// URL" }).optional(),
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
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.SITE_URL);
    if (env.NODE_ENV === "production" && !env.SITE_URL.startsWith("https://") && !local) {
      ctx.addIssue({ code: "custom", path: ["SITE_URL"], message: "must be an https:// address in production" });
    }
  });

export type Env = z.output<typeof envSchema>;

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
