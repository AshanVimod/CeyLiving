// @vitest-environment node
import { describe, expect, it } from "vitest";
import { withTestStore } from "@/test/store-helpers";
import {
  getPublicProduct,
  getPublicShop,
  lookupProducts,
  productCountByCategory,
  publicCatalogue,
  publicShops,
  queryCatalogue,
  relatedProducts,
  searchSuggestions,
} from "./catalogue";
import { transaction } from "./store/dev-store";

withTestStore();

const MASK_SHOP = "ambalangoda-mask-house";

describe("public catalogue", () => {
  it("RULE-S4 hides the seeded suspended shop and its items", async () => {
    expect(await getPublicShop("pol-katu-lanka")).toBeUndefined();
    expect(await getPublicProduct("coconut-shell-owl")).toBeUndefined();
    expect((await publicCatalogue()).some((p) => p.shopSlug === "pol-katu-lanka")).toBe(false);
  });

  it("RULE-S4 hides a shop everywhere as soon as it is suspended", async () => {
    expect(await getPublicProduct("naga-raksha-mask")).toBeDefined();
    const woodCount = await productCountByCategory("wood-carvings");

    await transaction((db) => {
      db.shops.find((s) => s.slug === MASK_SHOP)!.status = "SUSPENDED";
    });

    expect(await getPublicShop(MASK_SHOP)).toBeUndefined();
    expect(await getPublicProduct("naga-raksha-mask")).toBeUndefined();
    expect((await publicShops()).some((s) => s.slug === MASK_SHOP)).toBe(false);
    expect((await queryCatalogue({ q: "raksha" })).total).toBe(0);
    expect((await searchSuggestions("raksha", 8)).filter((s) => s.kind === "Product")).toEqual([]);
    expect((await lookupProducts(["naga-raksha-mask", "terracotta-vase-trio"])).map((p) => p.slug)).toEqual([
      "terracotta-vase-trio",
    ]);
    expect(await productCountByCategory("wood-carvings")).toBeLessThan(woodCount);
    const vase = (await getPublicProduct("terracotta-vase-trio"))!;
    expect((await relatedProducts(vase, 50)).some((p) => p.shopSlug === MASK_SHOP)).toBe(false);
  });

  it("RULE-P4 shows only ACTIVE products", async () => {
    await transaction((db) => {
      db.products.find((p) => p.slug === "naga-raksha-mask")!.status = "PENDING_REVIEW";
    });
    expect(await getPublicProduct("naga-raksha-mask")).toBeUndefined();
    expect(await getPublicProduct("gurulu-raksha-mask")).toBeDefined();
  });

  it("RULE-R4 counts only visible reviews in ratings", async () => {
    const before = (await getPublicProduct("naga-raksha-mask"))!.rating!;
    await transaction((db) => {
      const review = db.reviews.find((r) => r.productId === "prod_naga-raksha-mask")!;
      review.status = "HIDDEN";
    });
    expect((await getPublicProduct("naga-raksha-mask"))!.rating!.count).toBe(before.count - 1);
  });
});
