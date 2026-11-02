import type { JobHandler } from "@/lib/server/observability/job";
import { expireUnpaidOrder } from "@/lib/server/services/orders";

/** orders.expireUnpaid (BR-06), enqueued by checkout for each order's expires_at (B07). */
export const ordersExpireUnpaid: JobHandler<"orders.expireUnpaid"> = async (data) => ({
  orderId: data.orderId,
  ...(await expireUnpaidOrder(data.orderId)),
});
