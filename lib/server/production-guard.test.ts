// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// SEC-A8: the demo session and the dev store must refuse to work in production builds.
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ceyliving_demo_session" ? { value: "user_admin" } : undefined),
  }),
}));

const { getSession } = await import("@/lib/session");
const { isProductionRuntime, transaction } = await import("./store/dev-store");

afterEach(() => vi.unstubAllEnvs());

describe("SEC-A8 production guard", () => {
  it("ignores the demo cookie in production, even for an admin ID", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
    expect(await getSession()).toBeNull();
  });

  it("uses the demo cookie in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CEYLIVING_STORE_PATH", `${process.env.TEMP ?? "/tmp"}/ceyliving-guard-${process.pid}.json`);
    expect((await getSession())?.user.id).toBe("user_admin");
  });

  it("refuses every write in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(transaction(() => "write")).rejects.toThrow(/isn’t available/);
  });

  it("AU-09 production with DEMO_MODE=false still ignores the demo cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    expect(await getSession()).toBeNull();
  });

  it("AU-09 DEMO_MODE allows demo sign-in in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    expect((await getSession())?.user.id).toBe("user_admin");
  });
});
