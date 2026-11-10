// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { cacheTag } from "next/cache";
import { categories } from "@/lib/data/categories";
import { changeData, readAll, withTestDatabase } from "@/test/db";
import {
  getPublicProduct,
  getPublicShop,
  latestReviewsOfShop,
  lookupProducts,
  productCountByCategory,
  publicProductSlugs,
  publicProductsOfShop,
  publicReviewsOfProduct,
  publicShopRating,
  publicShopStats,
  publicShops,
  queryCatalogue,
  relatedProducts,
  searchSuggestions,
  shopRating,
  shopRatings,
} from "./catalogue";
import { CATALOGUE_TAG, PRODUCTS_TAG, SHOPS_TAG } from "./catalogue-tag";

withTestDatabase();

const MASK_SHOP = "ambalangoda-mask-house";

describe("public catalogue", () => {
  it("RULE-S4 hides the seeded suspended shop and its items", async () => {
    expect(await getPublicShop("pol-katu-lanka")).toBeUndefined();
    expect(await getPublicProduct("coconut-shell-owl")).toBeUndefined();
    expect((await queryCatalogue({})).items.some((p) => p.shopSlug === "pol-katu-lanka")).toBe(false);
  });

  it("RULE-S4 hides a shop everywhere as soon as it is suspended", async () => {
    expect(await getPublicProduct("naga-raksha-mask")).toBeDefined();
    const woodCount = await productCountByCategory("wood-carvings");

    await changeData((db) => {
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
    await changeData((db) => {
      db.products.find((p) => p.slug === "naga-raksha-mask")!.status = "PENDING_REVIEW";
    });
    expect(await getPublicProduct("naga-raksha-mask")).toBeUndefined();
    expect(await getPublicProduct("gurulu-raksha-mask")).toBeDefined();
  });

  it("RULE-R4 counts only visible reviews in ratings", async () => {
    const before = (await getPublicProduct("naga-raksha-mask"))!.rating!;
    await changeData((db) => {
      const review = db.reviews.find((r) => r.productId === "prod_naga-raksha-mask")!;
      review.status = "HIDDEN";
    });
    expect((await getPublicProduct("naga-raksha-mask"))!.rating!.count).toBe(before.count - 1);
  });
});

/** Every tag the code under test gave its cache entries, in call order. */
async function tagsOf(read: () => Promise<unknown>): Promise<string[]> {
  vi.mocked(cacheTag).mockClear();
  await read();
  return vi.mocked(cacheTag).mock.calls.flat();
}

describe("BE-09 cached reads carry narrow tags", () => {
  it("BE-09 a category list is tagged with its category and every item it shows, not the site-wide lists", async () => {
    const page = await queryCatalogue({ category: "wood-carvings", limit: 4 });
    const tags = await tagsOf(() => queryCatalogue({ category: "wood-carvings", limit: 4 }));
    expect(tags).toEqual(
      expect.arrayContaining([CATALOGUE_TAG, "category:wood-carvings", ...page.items.map((p) => `product:${p.id}`)]),
    );
    expect(tags).not.toContain(PRODUCTS_TAG);
  });

  it("BE-09 a shop's list is tagged with the shop and its items", async () => {
    const page = await publicProductsOfShop(MASK_SHOP, 3);
    const tags = await tagsOf(() => publicProductsOfShop(MASK_SHOP, 3));
    expect(tags).toEqual(expect.arrayContaining([`shop:${MASK_SHOP}`, ...page.items.map((p) => `product:${p.id}`)]));
    expect(tags).not.toContain(PRODUCTS_TAG);
  });

  it("BE-09 an item read is tagged with the item only; a slug that finds nothing waits on the site-wide lists", async () => {
    const naga = (await getPublicProduct("naga-raksha-mask"))!;
    const found = await tagsOf(() => getPublicProduct("naga-raksha-mask"));
    expect(found).toEqual([CATALOGUE_TAG, `product:${naga.id}`]);
    expect(await tagsOf(() => getPublicProduct("no-such-item"))).toEqual([CATALOGUE_TAG, PRODUCTS_TAG]);
  });

  it("BE-09 search and the home lists are site-wide; reviews, shops and ratings have their own tags", async () => {
    expect(await tagsOf(() => queryCatalogue({ q: "mask", limit: 2 }))).toContain(PRODUCTS_TAG);
    const shop = (await getPublicShop(MASK_SHOP))!;
    expect(await tagsOf(() => getPublicShop(MASK_SHOP))).toEqual([CATALOGUE_TAG, `shop:${MASK_SHOP}`]);
    expect(await tagsOf(() => getPublicShop("no-such-shop"))).toEqual([CATALOGUE_TAG, SHOPS_TAG]);
    expect(await tagsOf(() => publicShops())).toEqual([CATALOGUE_TAG, SHOPS_TAG]);
    expect(await tagsOf(() => publicShopRating(MASK_SHOP))).toEqual(
      expect.arrayContaining([`shop:${MASK_SHOP}`, `shop-reviews:${shop.id}`]),
    );
    expect(await tagsOf(() => publicReviewsOfProduct("prod_naga-raksha-mask"))).toEqual([
      CATALOGUE_TAG,
      "reviews:prod_naga-raksha-mask",
    ]);
    expect(await tagsOf(() => latestReviewsOfShop(shop.id, 6))).toContain(`shop-reviews:${shop.id}`);
  });

  it("BE-09 every cached read carries the catalogue tag, so the worker can still refresh everything", async () => {
    const reads = [
      () => queryCatalogue({}),
      () => publicShops(),
      () => publicShopStats(),
      () => productCountByCategory("wood-carvings"),
      () => publicProductSlugs(),
      () => searchSuggestions("mask", 5),
    ];
    for (const read of reads) expect(await tagsOf(read)).toContain(CATALOGUE_TAG);
  });

  it("BE-09 a long page splits its tags into calls of at most 128 (the Next.js limit)", async () => {
    vi.mocked(cacheTag).mockClear();
    await queryCatalogue({ limit: 200 });
    for (const call of vi.mocked(cacheTag).mock.calls) expect(call.length).toBeLessThanOrEqual(128);
  });
});

describe("B13 grouped reads give the same answers as one read per row", () => {
  it("B13 RULE-R4 RULE-S4 the makers stats equal each shop's own item count and rating", async () => {
    const stats = await publicShopStats();
    const shops = await publicShops();
    expect(Object.keys(stats).sort()).toEqual(shops.map((s) => s.slug).sort());
    for (const s of shops) {
      expect(stats[s.slug]!.count).toBe((await queryCatalogue({ shop: s.slug, limit: 1 })).total);
      expect(stats[s.slug]!.rating).toEqual(await publicShopRating(s.slug));
    }
  });

  it("B13 RULE-P4 each category tile's count equals that category's catalogue total", async () => {
    for (const c of categories) {
      expect(await productCountByCategory(c.slug)).toBe((await queryCatalogue({ category: c.slug, limit: 1 })).total);
    }
  });

  it("B13 admin ratings for several shops equal each shop's own, suspended shops included", async () => {
    const all = (await readAll()).shops;
    const ratings = await shopRatings(all.map((s) => s.id));
    for (const s of all) expect(ratings.get(s.id)).toEqual(await shopRating(s.slug));
  });
});
