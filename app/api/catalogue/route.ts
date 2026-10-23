import type { NextRequest } from "next/server";
import { SEARCH_SUGGESTION_LIMIT } from "@/lib/config";
import { lookupProducts, searchSuggestions } from "@/lib/server/catalogue";
import { withRoute } from "@/lib/server/observability/route";

const MAX_SLUGS = 50;
const SLUG = /^[a-z0-9-]{1,80}$/;

/**
 * Public catalogue data for browser-side features (cart, wishlist, recently viewed, search suggestions).
 * Returns only ACTIVE items of ACTIVE shops, so suspended shops disappear here too (RULE-S4).
 */
export const GET = withRoute("api.catalogue", (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const q = params.get("q");
  if (q !== null) {
    return Response.json({ suggestions: searchSuggestions(q.slice(0, 100), SEARCH_SUGGESTION_LIMIT) });
  }
  const slugs = (params.get("slugs") ?? "")
    .split(",")
    .filter((s) => SLUG.test(s))
    .slice(0, MAX_SLUGS);
  return Response.json({ products: lookupProducts(slugs) });
});
