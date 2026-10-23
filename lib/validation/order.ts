import { z } from "zod";
import { TEXT_LIMITS } from "../config";
import { reason, text } from "./common";

/** Seller actions on a seller order (spec BR-07). Courier is required to dispatch; cancelling needs a reason. */
export const orderTransitionSchema = z.discriminatedUnion("to", [
  z.object({ sellerOrderId: z.string().min(1), to: z.literal("ACCEPTED") }),
  z.object({ sellerOrderId: z.string().min(1), to: z.literal("IN_PROGRESS") }),
  z.object({
    sellerOrderId: z.string().min(1),
    to: z.literal("DISPATCHED"),
    courierName: text("the courier name", 2, 60),
    trackingRef: z
      .string()
      .optional()
      .transform((s) => (s ?? "").trim())
      .pipe(
        z
          .string()
          .max(40, "Tracking numbers are at most 40 characters.")
          .regex(/^[A-Za-z0-9-]*$/, "Use letters, numbers and hyphens only."),
      )
      .transform((s) => s || undefined),
  }),
  z.object({
    sellerOrderId: z.string().min(1),
    to: z.literal("CANCELLED"),
    reason: reason(TEXT_LIMITS.reasonMin, TEXT_LIMITS.reasonMax),
  }),
]);

export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;
