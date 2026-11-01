import type { NextRequest } from "next/server";
import { parseProductQuery } from "@/lib/catalogue";
import { PAGE_SIZE } from "@/lib/config";
import { queryCatalogue } from "@/lib/server/catalogue";
import { withRoute } from "@/lib/server/observability/route";

/**
 * The next page of a catalogue listing, for "Load more" (B04b). The filters are read with parseProductQuery like the
 * page itself, so nothing from the URL is trusted, and `after` is an opaque cursor that only decides where the page
 * starts (a bad one just gives the first page). Only ACTIVE items of ACTIVE shops are returned (RULE-P4, RULE-S4).
 */
export const GET = withRoute("api.catalogue.page", async (request: NextRequest) => {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const query = { ...parseProductQuery(params), limit: PAGE_SIZE };
  const after = params.after?.slice(0, 1000);
  const { items, next } = await queryCatalogue(query, after);
  return Response.json({ items, next: next ?? null });
});
