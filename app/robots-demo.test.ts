// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";

afterEach(() => vi.unstubAllEnvs());

describe("robots.txt on the public demo", () => {
  it("SEC-A8 Feature-02 DEMO_MODE asks every search engine to stay away and lists no sitemap", () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
