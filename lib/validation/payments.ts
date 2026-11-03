import { z } from "zod";
import { TEXT_LIMITS as T } from "../config";
import { id, reason } from "./common";

// B08: what the payment forms may send. Amounts are never among them: a refund is always the seller order's total,
// or the whole unusable payment (BR-18), worked out on the server.

const reference = z
  .string()
  .trim()
  .max(60)
  .regex(/^[A-Za-z0-9-]*$/, "Use letters, numbers and hyphens only.")
  .optional()
  .transform((value) => value || undefined);

/** PAY-07 / BR-18: refund one seller order, or (PAY-06) one whole payment flagged for a refund. */
export const refundSchema = z
  .object({
    sellerOrderId: id.optional(),
    paymentId: id.optional(),
    method: z.enum(["PAYHERE", "MANUAL"], { error: "Choose how the money goes back." }),
    reason: reason(T.reasonMin, T.reasonMax),
    reference,
  })
  .refine((v) => Boolean(v.sellerOrderId) !== Boolean(v.paymentId), { message: "Choose one order or one payment." })
  .refine((v) => v.method !== "MANUAL" || (v.reference && v.reference.length >= 4), {
    path: ["reference"],
    message: "Enter the bank transfer reference.",
  });

/** A PayHere refund that got no answer: the admin checked PayHere and records the outcome. */
export const resolveRefundSchema = z
  .object({
    refundId: id,
    outcome: z.enum(["succeeded", "failed"]),
    reference,
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.outcome !== "succeeded" || (v.reference && v.reference.length >= 4), {
    path: ["reference"],
    message: "Enter PayHere's refund number.",
  });

/** PAY-05: an admin releases a shop's chargeback hold, saying why (audited). */
export const releaseHoldSchema = z.object({ shopId: id, reason: reason(T.reasonMin, T.reasonMax) });

/** Development only: simulate PayHere's answer for the customer's own order. */
export const simulatePaymentSchema = z.object({
  orderNumber: z.string().regex(/^CM-\d{4}-\d{3,}$/),
  outcome: z.enum(["success", "failed", "cancelled"]),
});
