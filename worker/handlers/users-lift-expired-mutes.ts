import type { JobHandler } from "@/lib/server/observability/job";
import { liftExpiredMutesNow } from "@/lib/server/services/moderation";

/** users.liftExpiredMutes (RULE-M3), hourly. */
export const usersLiftExpiredMutes: JobHandler<"users.liftExpiredMutes"> = async () => ({
  unmuted: await liftExpiredMutesNow(),
});
