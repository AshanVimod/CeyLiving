// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EnvError, envSchema, getEnv, parseEnv } from "./env";

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

describe("lib/env", () => {
  it("AU-09 refuses ENABLE_DEMO_LOGIN=true when NODE_ENV=production", () => {
    expect(problems(() => parseEnv({ NODE_ENV: "production", ENABLE_DEMO_LOGIN: "true", DATABASE_URL: DB }))).toEqual([
      "ENABLE_DEMO_LOGIN: must not be true when NODE_ENV=production (AU-09)",
    ]);
  });

  it("AU-09 allows ENABLE_DEMO_LOGIN=true in development", () => {
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "true" }).ENABLE_DEMO_LOGIN).toBe(true);
  });

  it("SEC-A8 production without ENABLE_DEMO_LOGIN parses with demo login off", () => {
    expect(parseEnv({ NODE_ENV: "production", DATABASE_URL: DB })).toEqual({
      NODE_ENV: "production",
      ENABLE_DEMO_LOGIN: false,
      DATABASE_URL: DB,
      SITE_URL: "http://localhost:3000",
    });
  });

  it("DB-10 production needs DATABASE_URL, and only a postgresql:// address", () => {
    expect(problems(() => parseEnv({ NODE_ENV: "production" }))).toEqual([
      "DATABASE_URL: is required in production (DB-10)",
    ]);
    expect(problems(() => parseEnv({ DATABASE_URL: "mysql://db/ceyliving" }))).toEqual([
      "DATABASE_URL: must be a postgresql:// address",
    ]);
    expect(parseEnv({ NODE_ENV: "development" }).DATABASE_URL).toBeUndefined();
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
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "", DATABASE_URL: "" })).toEqual({
      NODE_ENV: "development",
      ENABLE_DEMO_LOGIN: false,
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
    expect(parseEnv({ NODE_ENV: "production", SITE_URL: "https://ceyliving.lk/", DATABASE_URL: DB }).SITE_URL).toBe(
      "https://ceyliving.lk",
    );
    expect(parseEnv({ NODE_ENV: "production", SITE_URL: "http://localhost:3002", DATABASE_URL: DB }).SITE_URL).toBe(
      "http://localhost:3002",
    );
    expect(
      problems(() => parseEnv({ NODE_ENV: "production", SITE_URL: "http://ceyliving.lk", DATABASE_URL: DB })),
    ).toEqual(["SITE_URL: must be an https:// address in production"]);
  });
});
