// @vitest-environment node
import { describe, expect, it } from "vitest";
import { filterAndSort, type CatalogueProduct, type ProductQuery } from "@/lib/catalogue";
import type { SeedData } from "@/prisma/seed-data";
import { readAll, withTestDatabase } from "@/test/db";
import { queryCatalogue } from "./catalogue";

// B04b acceptance: "catalogue filters and sorts behave as before". The in-memory filterAndSort in lib/catalogue.ts
// is the reference; the catalogue query must return the same items in the same order for every filter and sort.

withTestDatabase();

/** Public items as the catalogue shows them, built straight from the rows (RULE-P4, RULE-S4, RULE-R4). */
function reference(data: SeedData): CatalogueProduct[] {
  const shops = new Map(data.shops.map((s) => [s.slug, s]));
  return data.products
    .filter((p) => p.status === "ACTIVE" && shops.get(p.shopSlug)?.status === "ACTIVE")
    .map((p) => {
      const visible = data.reviews.filter((r) => r.productId === p.id && r.status === "VISIBLE");
      const rating = visible.length
        ? { average: visible.reduce((sum, r) => sum + r.rating, 0) / visible.length, count: visible.length }
        : undefined;
      return { ...p, shopName: shops.get(p.shopSlug)!.name, rating };
    });
}

const QUERIES: ProductQuery[] = [
  {},
  { sort: "newest" },
  { sort: "price_asc" },
  { sort: "price_desc" },
  { sort: "rating" },
  { category: "wood-carvings" },
  { category: "handloom-batik-lace", sort: "price_asc" },
  { minPrice: 500_000 },
  { maxPrice: 900_000, sort: "price_desc" },
  { minPrice: 300_000, maxPrice: 1_200_000 },
  { style: ["TRADITIONAL"] },
  { style: ["MODERN", "MINIMAL"], sort: "newest" },
  { type: "MADE_TO_ORDER" },
  { type: "READY_TO_SHIP", sort: "price_asc" },
  { customizable: true },
  { customizable: false, sort: "rating" },
  { material: ["wood"] },
  { material: ["clay", "fabric"], sort: "price_asc" },
  { inStock: true },
  { minRating: 4 },
  { category: "wood-carvings", material: ["wood"], inStock: true, sort: "price_desc" },
];

const ids = (items: { id: string }[]) => items.map((p) => p.id);

describe("B04b catalogue filters and sorts behave as before", () => {
  it.each(QUERIES.map((q) => [JSON.stringify(q), q] as const))("%s", async (_, query) => {
    const expected = filterAndSort(reference(await readAll()), query);
    const actual = await queryCatalogue(query);
    expect(ids(actual.items)).toEqual(ids(expected.items));
    expect(actual.total).toBe(expected.total);
  });

  it("a keyword finds the same items as before", async () => {
    const data = await readAll();
    for (const q of ["mask", "raksha", "batik", "wood", "clay vase", "beeralu lace"]) {
      const expected = filterAndSort(reference(data), { q, sort: "price_asc" });
      expect(ids((await queryCatalogue({ q, sort: "price_asc" })).items), q).toEqual(ids(expected.items));
    }
  });
});
