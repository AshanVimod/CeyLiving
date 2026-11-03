import type { JobHandler } from "@/lib/server/observability/job";
import { reconcilePayments } from "@/lib/server/services/payments";

/** payments.reconcile (PAY-08), daily 02:00 Asia/Colombo: compares yesterday's orders with PayHere and reports. */
export const paymentsReconcile: JobHandler<"payments.reconcile"> = async (_data, log) => {
  const result = await reconcilePayments(log);
  return "skipped" in result
    ? { reconciled: false }
    : { reconciled: true, day: result.day, checked: result.checked, differences: result.differences.length };
};
