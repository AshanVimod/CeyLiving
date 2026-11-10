import type { JobHandler } from "@/lib/server/observability/job";
import { pruneRateLimitRows } from "@/lib/server/services/maintenance";

/** rateLimits.prune (12.4, B12), hourly at :25. */
export const rateLimitsPrune: JobHandler<"rateLimits.prune"> = async () => ({ deleted: await pruneRateLimitRows() });
