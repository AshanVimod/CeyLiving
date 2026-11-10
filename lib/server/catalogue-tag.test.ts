import { describe, expect, it } from "vitest";
import { tagsFor } from "./catalogue-tag";

// BE-09 (B13): which cached catalogue reads each kind of change expires. The tags on the reads themselves are
// checked in catalogue.test.ts, and the actions that call this in actions-permissions.test.ts.

describe("BE-09 tagsFor", () => {
  it("BE-09 an item change reaches its page, its shop, its category and the site-wide lists, nothing wider", () => {
    expect(tagsFor({ kind: "product", productId: "prod_1", shopSlug: "masks", categorySlug: "wood-carvings" })).toEqual(
      ["product:prod_1", "shop:masks", "category:wood-carvings", "products"],
    );
  });

  it("BE-09 an order reaches only the ordered items, each once", () => {
    expect(tagsFor({ kind: "stock", productIds: ["prod_1", "prod_2", "prod_1"] })).toEqual([
      "product:prod_1",
      "product:prod_2",
    ]);
    expect(tagsFor({ kind: "stock", productIds: [] })).toEqual([]);
  });

  it("BE-09 a review reaches its item's reviews and rating and its shop's reviews, not the site-wide lists", () => {
    expect(tagsFor({ kind: "review", productId: "prod_1", shopId: "shop_1" })).toEqual([
      "reviews:prod_1",
      "product:prod_1",
      "shop-reviews:shop_1",
    ]);
  });

  it("BE-09 only a shop-wide change refreshes the whole catalogue", () => {
    expect(tagsFor({ kind: "everything" })).toEqual(["catalogue"]);
  });
});
