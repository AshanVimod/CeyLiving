// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTestStore } from "@/test/store-helpers";
import { transaction } from "@/lib/server/store/dev-store";
import robots from "./robots";
import sitemap from "./sitemap";

withTestStore();
afterEach(() => vi.unstubAllEnvs());

const urls = async () => (await sitemap()).map((e) => e.url);

describe("sitemap.xml and robots.txt", () => {
  it("FR-2c lists public pages, categories, active shops and active items with absolute links", async () => {
    vi.stubEnv("SITE_URL", "https://ceyliving.lk");
    const list = await urls();
    expect(list).toContain("https://ceyliving.lk");
    expect(list).toContain("https://ceyliving.lk/c/wood-carvings");
    expect(list).toContain("https://ceyliving.lk/shop/ambalangoda-mask-house");
    expect(list).toContain("https://ceyliving.lk/p/naga-raksha-mask");
    expect(list.every((u) => u.startsWith("https://ceyliving.lk"))).toBe(true);
  });

  it("RULE-S4 leaves out a suspended shop and all its items", async () => {
    expect(await urls()).not.toContain("http://localhost:3000/shop/pol-katu-lanka"); // seeded as suspended
    await transaction((db) => {
      db.shops.find((s) => s.slug === "ambalangoda-mask-house")!.status = "SUSPENDED";
    });
    const list = await urls();
    expect(list.some((u) => u.endsWith("/shop/ambalangoda-mask-house"))).toBe(false);
    expect(list.some((u) => u.endsWith("/p/naga-raksha-mask"))).toBe(false);
  });

  it("RULE-P4 leaves out items that aren't ACTIVE", async () => {
    await transaction((db) => {
      db.products.find((p) => p.slug === "naga-raksha-mask")!.status = "PENDING_REVIEW";
    });
    expect((await urls()).some((u) => u.endsWith("/p/naga-raksha-mask"))).toBe(false);
  });

  it("SEC-A1 robots.txt keeps crawlers out of signed-in areas and points to the sitemap", () => {
    vi.stubEnv("SITE_URL", "https://ceyliving.lk");
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0]! : result.rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/account", "/seller", "/admin", "/api/"]));
    expect(result.sitemap).toBe("https://ceyliving.lk/sitemap.xml");
  });
});
