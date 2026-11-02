import type { JobHandler } from "@/lib/server/observability/job";
import { runPayouts } from "@/lib/server/services/payouts";
import { WORKER } from "@/lib/server/services/shared";

/** payouts.generateWeekly (BR-11), Mondays 06:00 Sri Lankan time. The admin button runs the same service. */
export const payoutsGenerateWeekly: JobHandler<"payouts.generateWeekly"> = async () => {
  const created = await runPayouts(WORKER);
  return { payouts: created.length, netCents: created.reduce((sum, p) => sum + p.netCents, 0) };
};
