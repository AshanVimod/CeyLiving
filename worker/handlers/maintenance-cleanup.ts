import type { JobHandler } from "@/lib/server/observability/job";
import { cleanUpOldRows } from "@/lib/server/services/maintenance";

/** maintenance.cleanup (backend plan 10.2), daily 03:00. */
export const maintenanceCleanup: JobHandler<"maintenance.cleanup"> = async () => ({ deleted: await cleanUpOldRows() });
