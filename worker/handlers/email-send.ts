import type { JobHandler } from "@/lib/server/observability/job";
import { deliverEmail } from "@/lib/server/services/email";

/**
 * email.send (backend plan 10.2, B10): sends one queued email and records the provider's message id. The log line
 * names the delivery, the outcome and the provider, never the address or the email (OPS-01).
 */
export const emailSend: JobHandler<"email.send"> = async (data) => ({
  deliveryId: data.deliveryId,
  ...(await deliverEmail(data.deliveryId)),
});
