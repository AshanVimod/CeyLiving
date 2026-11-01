// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { withTestDatabase } from "@/test/db";
import { GET } from "./route";

// B04b: the "Load more" endpoint. Only ACTIVE items of ACTIVE shops (RULE-P4, RULE-S4), only filters a visitor may
// set (SEC-A3), and the cursor only decides where the page starts.

withTestDatabase();

async function page(query: string) {
  const response = await GET(new NextRequest(`http://localhost/api/catalogue/page?${query}`));
  expect(response.status).toBe(200);
  return (await response.json()) as {
    items: { slug: string; shopSlug: string; status: string }[];
    next: string | null;
  };
}

describe("B04b /api/catalogue/page", () => {
  it("pages through the listing with the cursor it returns", async () => {
    const first = await page("sort=price_asc");
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.next).toEqual(expect.any(String));
    const second = await page(`sort=price_asc&after=${first.next}`);
    expect(second.items.some((p) => first.items.some((f) => f.slug === p.slug))).toBe(false);
  });

  it("SEC-A3 ignores server-only filters smuggled into the URL and never returns hidden items", async () => {
    const all = await page("");
    const smuggled = await page("shop=pol-katu-lanka&slugs=coconut-shell-owl&heritage=false&limit=500");
    expect(smuggled.items.map((p) => p.slug)).toEqual(all.items.map((p) => p.slug));
    expect(smuggled.items.some((p) => p.shopSlug === "pol-katu-lanka")).toBe(false);
    expect(smuggled.items.length).toBeLessThanOrEqual(12);
  });

  it("a broken cursor gives the first page, not an error", async () => {
    const first = await page("sort=newest");
    expect((await page("sort=newest&after=%27%3B--")).items).toEqual(first.items);
  });
});
