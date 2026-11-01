// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "@/test/db";

// SEC-A8 / AU-09: the demo session must refuse to work in production builds.
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ceyliving_demo_session" ? { value: "user_admin" } : undefined),
  }),
}));

const { getSession } = await import("@/lib/session");
const { isProductionRuntime } = await import("./runtime");

withTestDatabase();

afterEach(() => vi.unstubAllEnvs());

describe("SEC-A8 production guard", () => {
  it("ignores the demo cookie in production, even for an admin ID", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
    expect(await getSession()).toBeNull();
  });

  it("uses the demo cookie in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await getSession())?.user.id).toBe("user_admin");
  });
});
