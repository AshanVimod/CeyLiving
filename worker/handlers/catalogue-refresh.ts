import type { JobHandler } from "@/lib/server/observability/job";
import { requestCatalogueRefresh } from "@/lib/server/services/catalogue-refresh";

/** catalogue.refresh (B07): after stock came back, the web app drops its cached catalogue. */
export const catalogueRefresh: JobHandler<"catalogue.refresh"> = async (_data, log) => ({
  refresh: await requestCatalogueRefresh(log),
});
