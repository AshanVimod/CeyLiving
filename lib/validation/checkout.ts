import { z } from "zod";
import { MAX_CART_QUANTITY, PRODUCT_LIMITS } from "../config";
import { addressSchema } from "./profile";

/** The most cart lines one checkout takes. */
export const MAX_CHECKOUT_LINES = 50;

/**
 * BR-04: a cart line names an item, a variant and a quantity. Nothing else from the browser is used: prices,
 * totals, shop ids and stock are read from the database, and unknown fields are dropped.
 */
export const checkoutLineSchema = z.object({
  productSlug: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(100),
  quantity: z.coerce
    .number()
    .int()
    .min(1, "Each item needs a quantity of at least 1.")
    .max(MAX_CART_QUANTITY, `You can buy at most ${MAX_CART_QUANTITY} of one item.`),
  // BR-16: checked against the item's own customization fields in the service. Here only the shape and size.
  customization: z
    .record(z.string().max(60), z.string().max(PRODUCT_LIMITS.customFieldMaxLength * 2))
    .refine((r) => Object.keys(r).length <= PRODUCT_LIMITS.maxCustomFields, "Too many personalisation details.")
    .default({}),
});

export const checkoutSchema = z.object({
  /** Made by the checkout page when it opens: the same key twice returns the same order. */
  idempotencyKey: z.uuid("Reload the checkout page and try again."),
  lines: z
    .array(checkoutLineSchema)
    .min(1, "Your cart is empty.")
    .max(MAX_CHECKOUT_LINES, `A checkout can have at most ${MAX_CHECKOUT_LINES} lines.`),
  shippingAddress: addressSchema.omit({ label: true }),
});

export type CheckoutLineInput = z.infer<typeof checkoutLineSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
