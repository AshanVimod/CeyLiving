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

describe("lib/env", () => {
  it("AU-09 refuses ENABLE_DEMO_LOGIN=true when NODE_ENV=production", () => {
    expect(problems(() => parseEnv({ NODE_ENV: "production", ENABLE_DEMO_LOGIN: "true" }))).toEqual([
      "ENABLE_DEMO_LOGIN: must not be true when NODE_ENV=production (AU-09)",
    ]);
  });

  it("AU-09 allows ENABLE_DEMO_LOGIN=true in development", () => {
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "true" }).ENABLE_DEMO_LOGIN).toBe(true);
  });

  it("SEC-A8 production without ENABLE_DEMO_LOGIN parses with demo login off", () => {
    expect(parseEnv({ NODE_ENV: "production" })).toEqual({ NODE_ENV: "production", ENABLE_DEMO_LOGIN: false });
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
    expect(parseEnv({ NODE_ENV: "development", ENABLE_DEMO_LOGIN: "", CEYLIVING_STORE_PATH: "" })).toEqual({
      NODE_ENV: "development",
      ENABLE_DEMO_LOGIN: false,
    });
  });

  it("12.3 getEnv reads the current environment on every call", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEMO_LOGIN", "true");
    expect(getEnv().ENABLE_DEMO_LOGIN).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getEnv()).toThrow(EnvError);
  });
});
