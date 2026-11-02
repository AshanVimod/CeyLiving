import type { JobHandler } from "@/lib/server/observability/job";
import { expireStaleRequests } from "@/lib/server/services/custom-requests";

/** customRequests.expire (FR-14), hourly. */
export const customRequestsExpire: JobHandler<"customRequests.expire"> = async () => ({
  expired: await expireStaleRequests(),
});
