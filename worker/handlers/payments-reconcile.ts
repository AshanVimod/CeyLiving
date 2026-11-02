import type { JobHandler } from "@/lib/server/observability/job";

/** payments.reconcile (PAY-08), daily 02:00: a stub until B08 adds PayHere payments to compare against. */
export const paymentsReconcile: JobHandler<"payments.reconcile"> = async (_data, log) => {
  log.info("job.stub: payments.reconcile arrives in B08; there are no payments to compare yet");
  return { reconciled: false };
};
