// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/types";
import { changeData, readAll, withTestDatabase } from "@/test/db";
import { getPublicProduct, queryCatalogue, searchSuggestions } from "./catalogue";
import { decodeCursor, encodeCursor, toSearchQuery } from "./repositories/catalogue-search";

// B04b: full-text search, typo-tolerant suggestions and keyset pages on PostgreSQL.

withTestDatabase();

const slugsOf = (page: { items: { slug: string }[] }) => page.items.map((p) => p.slug);

/** A new public item in the mask shop, copied from the Naga mask with its own id, slug and text. */
async function addItem(fields: Partial<Product> & { id: string; slug: string }) {
  await changeData((data) => {
    const base = data.products.find((p) => p.slug === "naga-raksha-mask")!;
    data.products.push({ ...structuredClone(base), featuredRank: undefined, tags: [], ...fields });
  });
}

describe("B04b search finds items by title, tag, material, shop and category", () => {
  it("finds by title, tag and material", async () => {
    expect(slugsOf(await queryCatalogue({ q: "elephant" }))).toContain("carved-elephant-family");
    expect(slugsOf(await queryCatalogue({ q: "kolam" }))).toEqual(
      expect.arrayContaining(["naga-raksha-mask", "gurulu-raksha-mask"]),
    );
    const clay = await queryCatalogue({ q: "clay" });
    expect(clay.total).toBeGreaterThan(0);
    expect(clay.items.every((p) => p.materials.includes("clay") || /clay/i.test(p.title + p.description))).toBe(true);
  });

  it("finds by the shop's name and the category's name", async () => {
    const byShop = await queryCatalogue({ q: "dumbara" });
    expect(byShop.items.map((p) => p.shopSlug)).toContain("dumbara-weavers");
    const byCategory = await queryCatalogue({ q: "wood carvings" });
    expect(byCategory.items.length).toBeGreaterThan(0);
    expect(byCategory.items.every((p) => p.categorySlug === "wood-carvings" || /wood/i.test(p.title + p.description)));
  });

  it("matches the start of a word and needs every word", async () => {
    expect(slugsOf(await queryCatalogue({ q: "rak" }))).toContain("naga-raksha-mask");
    expect(slugsOf(await queryCatalogue({ q: "raksha naga" }))[0]).toBe("naga-raksha-mask"); // title match first
    expect((await queryCatalogue({ q: "raksha zzzz" })).total).toBe(0);
  });

  it("finds Sinhala item names and Sinhala category names", async () => {
    await addItem({ id: "prod_si_box", slug: "lacquer-box-si", title: "ලාක්ෂා පෙට්ටිය", tags: ["ලාක්ෂා"] });
    expect(slugsOf(await queryCatalogue({ q: "ලාක්ෂා" }))).toEqual(["lacquer-box-si"]);
    expect(slugsOf(await queryCatalogue({ q: "පෙට්ටිය" }))).toEqual(["lacquer-box-si"]);
    expect(slugsOf(await queryCatalogue({ q: "ලාක්" }))).toEqual(["lacquer-box-si"]); // start of a word
    // "වෙස් මුහුණු" (masks) is the Sinhala name of the wood carvings category.
    const masks = await queryCatalogue({ q: "වෙස් මුහුණු" });
    expect(masks.total).toBeGreaterThan(0);
    expect(masks.items.every((p) => p.categorySlug === "wood-carvings")).toBe(true);
    expect((await searchSuggestions("වෙස්", 8)).map((s) => s.label)).toContain("Wood Carvings");
  });

  it("BE-04 treats search text as words only: quotes and operators can't change the query", async () => {
    for (const q of ["';--", "a' OR 1=1 --", "&|!:*()", "raksha & !naga", "x".repeat(5000), "%_\\"]) {
      const page = await queryCatalogue({ q });
      expect(
        page.items.every((p) => p.status === "ACTIVE"),
        q,
      ).toBe(true);
    }
    expect(toSearchQuery("raksha & !naga | x:*")).toBe("raksha:* & naga:* & x:*");
    expect(toSearchQuery("';--")).toBeUndefined();
    expect((await queryCatalogue({ q: "';--" })).total).toBe(0);
    // "!" is not a NOT: the same as searching "raksha naga".
    expect(slugsOf(await queryCatalogue({ q: "raksha & !naga" }))).toEqual(
      slugsOf(await queryCatalogue({ q: "raksha naga" })),
    );
  });

  it("puts title matches first when searching with the default order", async () => {
    await addItem({
      id: "prod_zz_desc",
      slug: "zz-desc",
      title: "Carved bowl",
      description: "Made of zebrawood. ".repeat(4),
    });
    await addItem({ id: "prod_zz_title", slug: "zz-title", title: "Zebrawood bowl" });
    expect(slugsOf(await queryCatalogue({ q: "zebrawood" }))).toEqual(["zz-title", "zz-desc"]);
  });

  it("suggests close spellings when nothing matches (pg_trgm)", async () => {
    const suggestions = await searchSuggestions("batk", 8);
    expect(suggestions.some((s) => s.kind === "Product" && /batik/i.test(s.label))).toBe(true);
    expect(await searchSuggestions("x", 8)).toEqual([]);
  });
});

describe("B04b search follows every change at once", () => {
  it("an added, renamed, hidden or archived item shows up in search and suggestions as it changes", async () => {
    await addItem({ id: "prod_new_q", slug: "kingfisher-mask", title: "Kingfisher mask" });
    expect(slugsOf(await queryCatalogue({ q: "kingfisher" }))).toEqual(["kingfisher-mask"]);
    expect((await searchSuggestions("kingfisher", 8)).map((s) => s.label)).toContain("Kingfisher mask");

    await changeData((data) => {
      data.products.find((p) => p.slug === "kingfisher-mask")!.title = "Hornbill mask";
    });
    expect((await queryCatalogue({ q: "kingfisher" })).total).toBe(0);
    expect(slugsOf(await queryCatalogue({ q: "hornbill" }))).toEqual(["kingfisher-mask"]);

    for (const status of ["REMOVED", "ARCHIVED", "DRAFT"] as const) {
      await changeData((data) => {
        data.products.find((p) => p.slug === "kingfisher-mask")!.status = status;
      });
      expect((await queryCatalogue({ q: "hornbill" })).total, status).toBe(0);
      expect(
        (await searchSuggestions("hornbill", 8)).some((s) => s.kind === "Product"),
        status,
      ).toBe(false);
      expect(await getPublicProduct("kingfisher-mask"), status).toBeUndefined();
    }
  });
});

/** Every item for `query`, read `size` at a time through the cursors. */
async function walk(query: Parameters<typeof queryCatalogue>[0], size: number) {
  const seen: string[] = [];
  let after: string | undefined;
  for (let i = 0; i < 100; i++) {
    const page = await queryCatalogue({ ...query, limit: size }, after);
    seen.push(...slugsOf(page));
    if (!page.next) return seen;
    after = page.next;
  }
  throw new Error("too many pages");
}

describe("B04b keyset pages", () => {
  it.each(["featured", "newest", "price_asc", "price_desc", "rating"] as const)(
    "%s: the pages together are the whole list, in order, each item once",
    async (sort) => {
      const all = slugsOf(await queryCatalogue({ sort }));
      expect(await walk({ sort }, 3)).toEqual(all);
    },
  );

  it("ties in price still give every item once", async () => {
    await changeData((data) => {
      for (const p of data.products) for (const v of p.variants) v.priceCents = 500_000;
    });
    const all = slugsOf(await queryCatalogue({ sort: "price_asc" }));
    const walked = await walk({ sort: "price_asc" }, 4);
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(walked.length);
  });

  it("items added or removed between two pages never repeat or skip the others", async () => {
    const first = await queryCatalogue({ sort: "newest", limit: 4 });
    const shown = slugsOf(first);
    const before = slugsOf(await queryCatalogue({ sort: "newest" }));
    const removed = before[6]!; // on a later page

    // Meanwhile: a brand-new item (it sorts first) and a later item is archived.
    await addItem({ id: "prod_fresh", slug: "fresh-item", title: "Fresh item", publishedAt: "2026-12-31" });
    await changeData((data) => {
      data.products.find((p) => p.slug === removed)!.status = "ARCHIVED";
    });

    const rest: string[] = [];
    let after = first.next;
    while (after) {
      const page = await queryCatalogue({ sort: "newest", limit: 4 }, after);
      rest.push(...slugsOf(page));
      after = page.next;
    }
    expect(rest.filter((slug) => shown.includes(slug))).toEqual([]); // nothing repeats
    expect(rest).not.toContain(removed);
    expect(rest).not.toContain("fresh-item"); // it sorts before the cursor; a fresh visit shows it first
    expect(rest).toEqual(before.slice(4).filter((slug) => slug !== removed)); // nothing skipped
    expect(slugsOf(await queryCatalogue({ sort: "newest", limit: 1 }))).toEqual(["fresh-item"]);
  });

  it("a tampered cursor, or one from another sort, just gives the first page", async () => {
    const first = slugsOf(await queryCatalogue({ sort: "price_asc", limit: 3 }));
    const newestNext = (await queryCatalogue({ sort: "newest", limit: 3 })).next!;
    for (const after of ["garbage", "e30", newestNext, encodeCursor({ sort: "price_asc", keys: [1, 2, 3], id: "x" })]) {
      expect(slugsOf(await queryCatalogue({ sort: "price_asc", limit: 3 }, after)), after).toEqual(first);
    }
    expect(decodeCursor("x".repeat(2000), "price_asc", 1)).toBeUndefined();
  });

  it("the total counts every match, on every page", async () => {
    const { total, next } = await queryCatalogue({ material: ["fabric"], limit: 2 });
    expect((await queryCatalogue({ material: ["fabric"], limit: 2 }, next)).total).toBe(total);
    const data = await readAll();
    const shops = new Map(data.shops.map((s) => [s.slug, s.status]));
    expect(total).toBe(
      data.products.filter(
        (p) => p.status === "ACTIVE" && shops.get(p.shopSlug) === "ACTIVE" && p.materials.includes("fabric"),
      ).length,
    );
  });
});
