import type { JobHandler } from "@/lib/server/observability/job";
import { watchOps } from "@/lib/server/services/ops";

/** ops.watch (B12, OPS-06), every 5 minutes: turns security event counts and live limits into admin alerts. */
export const opsWatch: JobHandler<"ops.watch"> = async () => watchOps();
