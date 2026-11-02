import type { JobHandler } from "@/lib/server/observability/job";

/**
 * orders.expireUnpaid (BR-06): a stub until B07, which adds unpaid orders (payment status, expires_at), reserves
 * stock at checkout and enqueues this job for each order's expiry time.
 */
export const ordersExpireUnpaid: JobHandler<"orders.expireUnpaid"> = async (data, log) => {
  log.warn({ orderId: data.orderId }, "job.stub: orders.expireUnpaid arrives in B07; nothing was changed");
  return { expired: false };
};
