import type { JobHandler } from "@/lib/server/observability/job";
import { autoCancelUnacceptedOrders } from "@/lib/server/services/orders";

/** orders.autoCancelUnaccepted (BR-08), every 15 minutes. */
export const ordersAutoCancelUnaccepted: JobHandler<"orders.autoCancelUnaccepted"> = async () => ({
  cancelled: await autoCancelUnacceptedOrders(),
});
