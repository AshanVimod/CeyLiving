"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { refundSchema, releaseHoldSchema, resolveRefundSchema, simulatePaymentSchema } from "@/lib/validation/payments";
import { requireActor } from "../auth";
import { logger } from "../observability/logger";
import { formToObject, parseInput, runAction } from "../run-action";
import {
  refundSellerOrder,
  refundUnusablePayment,
  releasePayoutHold,
  resolvePendingRefund,
  simulatePayment,
} from "../services/payments";

// B08 (PAY-05 to PAY-07): admin refunds and holds, and the dev-only payment simulator. Who → validate → service →
// refresh, like every action. Amounts never come from the form.

function refreshMoneyPages() {
  revalidatePath("/admin/payments");
  revalidatePath("/admin/payouts");
  revalidatePath("/account/orders");
  revalidatePath("/seller/orders");
}

export async function refundAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(refundSchema, formToObject(form));
    const request = { method: input.method, reason: input.reason, reference: input.reference };
    const refund = input.sellerOrderId
      ? await refundSellerOrder(actor, input.sellerOrderId, request)
      : await refundUnusablePayment(actor, input.paymentId!, request);
    refreshMoneyPages();
    return {
      ok: true,
      message: refund.status === "SUCCEEDED" ? "Refund recorded. The customer has been told." : "Refund requested.",
    };
  });
}

export async function resolveRefundAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(resolveRefundSchema, formToObject(form));
    await resolvePendingRefund(
      actor,
      input.refundId,
      input.outcome === "succeeded"
        ? { succeeded: true, reference: input.reference! }
        : { succeeded: false, note: input.note || "no refund found" },
    );
    refreshMoneyPages();
    return { ok: true, message: "Recorded." };
  });
}

export async function releaseHoldAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(releaseHoldSchema, formToObject(form));
    await releasePayoutHold(actor, input.shopId, input.reason);
    refreshMoneyPages();
    return { ok: true, message: "Payouts released for this shop." };
  });
}

/** Development only (the service refuses in production): PayHere's answer, correctly signed, for your own order. */
export async function simulatePaymentAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(simulatePaymentSchema, formToObject(form));
    await simulatePayment(actor, input.orderNumber, input.outcome, logger);
    revalidatePath(`/account/orders/${input.orderNumber}`);
    revalidatePath("/seller/orders");
    // Where PayHere's return_url would take the customer.
    redirect(`/checkout/result?order=${encodeURIComponent(input.orderNumber)}`);
  });
}
