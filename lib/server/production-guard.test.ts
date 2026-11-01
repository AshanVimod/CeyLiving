// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestDatabase } from "@/test/db";

// SEC-A8 / AU-09: before B05a a "ceyliving_demo_session" cookie holding a user ID signed people in. That cookie
// must mean nothing now, in development and in production: only a signed Better Auth session counts. (Demo
// sign-in itself is tested in auth-flows.test.ts.)
vi.mock("next/server", () => ({ connection: async () => undefined }));
const forged = new Headers({ cookie: "ceyliving_demo_session=user_admin; ceyliving.session_token=forged" });
vi.mock("next/headers", () => ({
  headers: async () => forged,
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
}));

const { getSession } = await import("@/lib/session");

withTestDatabase();

afterEach(() => vi.unstubAllEnvs());

describe("SEC-A8 production guard", () => {
  it.each(["development", "production"])("a forged or old demo cookie signs no one in (%s)", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    expect(await getSession()).toBeNull();
  });
});
