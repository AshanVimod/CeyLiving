import { revalidateTag } from "next/cache";
import { CATALOGUE_TAG } from "@/lib/server/catalogue-tag";
import { withRoute } from "@/lib/server/observability/route";
import { isCatalogueRefreshAllowed } from "@/lib/server/services/catalogue-refresh";

/**
 * B07: the worker's catalogue.refresh job calls this after stock came back (an unpaid order expired), so shop pages
 * stop showing it as sold out. Only callers with CACHE_REFRESH_SECRET; anyone else gets a plain 404.
 */
export const POST = withRoute(
  "api.internal.catalogue-refresh",
  async (request) => {
    if (!isCatalogueRefreshAllowed(request.headers.get("authorization"))) return new Response(null, { status: 404 });
    // expire 0: the next visit reads fresh rows instead of being served the stale "sold out" once more.
    revalidateTag(CATALOGUE_TAG, { expire: 0 });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  },
  {
    // 12.2: only the worker calls this, with a bearer secret and no cookies, so there is no Origin to check.
    origin: { exempt: "worker-to-web, authenticated by CACHE_REFRESH_SECRET" },
  },
);
