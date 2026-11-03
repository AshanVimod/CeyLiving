import { withRoute } from "@/lib/server/observability/route";
import { receivePayHereNotification } from "@/lib/server/services/payments";

/**
 * PAY-03 (backend plan 3.2): PayHere's server-to-server payment notification, the only thing that marks an order
 * paid (BR-09). The signature (md5sig) is the authentication, so there is no session or CSRF check. Every
 * notification that reaches the service gets 200, accepted or not (a rejected one is logged as a security event);
 * only an unexpected failure gets withRoute's 500, so PayHere may send it again.
 */
export const POST = withRoute("api.payments.payhere.notify", async (request, log) => {
  let fields: Record<string, unknown> = {};
  try {
    fields = Object.fromEntries((await request.formData()).entries());
  } catch {
    // Not a form body: the service rejects the empty field set and logs it.
  }
  await receivePayHereNotification(fields, log);
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
});
