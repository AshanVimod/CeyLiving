// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestStore } from "@/test/store-helpers";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => jar.set(name, value),
    delete: (n: string) => jar.delete(n),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect:${to}`), { to });
  },
}));
const { signInAsDemo } = await import("./session");

withTestStore();
afterEach(() => {
  jar.clear();
  vi.unstubAllEnvs();
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  return fd;
};

describe("demo sign-in", () => {
  it("AU-09 signs in a demo account and returns to a path on this site", async () => {
    await expect(signInAsDemo(form({ userId: "user_seller", next: "/seller" }))).rejects.toThrow("redirect:/seller");
    expect(jar.get("ceyliving_demo_session")).toBe("user_seller");
  });

  it("SEC-A3 / AU-09 refuses an account that isn't on the demo list, even a real user ID", async () => {
    await expect(signInAsDemo(form({ userId: "user_muted" }))).rejects.toThrow("redirect:/signin");
    await expect(signInAsDemo(form({ userId: "user_owner_galle-beeralu-studio" }))).rejects.toThrow("redirect:/signin");
    await expect(signInAsDemo(form({}))).rejects.toThrow("redirect:/signin");
    expect(jar.size).toBe(0);
  });

  it("SEC-A3 never redirects off the site after sign-in", async () => {
    await expect(signInAsDemo(form({ userId: "user_admin", next: "https://evil.example" }))).rejects.toThrow(
      "redirect:/account",
    );
  });

  it("SEC-A8 refuses demo sign-in in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(signInAsDemo(form({ userId: "user_admin" }))).rejects.toThrow("redirect:/signin");
    expect(jar.size).toBe(0);
  });
});
