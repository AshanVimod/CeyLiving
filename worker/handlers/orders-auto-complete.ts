import type { JobHandler } from "@/lib/server/observability/job";
import { autoCompleteDispatchedOrders } from "@/lib/server/services/orders";

/** orders.autoComplete (BR-17), hourly. */
export const ordersAutoComplete: JobHandler<"orders.autoComplete"> = async () => ({
  completed: await autoCompleteDispatchedOrders(),
});
