import type { NextRequest } from "next/server";
import { z } from "zod";
import { parseProductQuery } from "@/lib/catalogue";
import { PAGE_SIZE } from "@/lib/config";
import { getPublicShop, publicProductsOfShop, queryCatalogue } from "@/lib/server/catalogue";
import { withRoute } from "@/lib/server/observability/route";

/**
 * The next page of a catalogue listing, for "Load more" (B04b). The filters are read with parseProductQuery like the
 * page itself, so nothing from the URL is trusted, and `after` is an opaque cursor that only decides where the page
 * starts (a bad one just gives the first page). Only ACTIVE items of ACTIVE shops are returned (RULE-P4, RULE-S4).
 */

/** B13: a shop page's next page. Only a slug's shape gets through; the shop must then be public (RULE-S4). */
const shopSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);

export const GET = withRoute("api.catalogue.page", async (request: NextRequest) => {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const after = params.after?.slice(0, 1000);
  if (params.shop !== undefined) {
    const slug = shopSlug.safeParse(params.shop);
    // The shop page's own order (featured); other filters don't apply. The slug passed on is the stored one.
    const shop = slug.success ? await getPublicShop(slug.data) : undefined;
    if (!shop) return Response.json({ items: [], next: null });
    const { items, next } = await publicProductsOfShop(shop.slug, PAGE_SIZE, after);
    return Response.json({ items, next: next ?? null });
  }
  const query = { ...parseProductQuery(params), limit: PAGE_SIZE };
  const { items, next } = await queryCatalogue(query, after);
  return Response.json({ items, next: next ?? null });
});
