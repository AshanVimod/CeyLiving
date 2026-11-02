"use server";

import { revalidatePath, updateTag } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { checkoutSchema } from "@/lib/validation/checkout";
import { requireActor } from "../auth";
import { CATALOGUE_TAG } from "../catalogue-tag";
import { formToObject, parseInput, runAction } from "../run-action";
import { placeOrder } from "../services/checkout";

/** What the checkout form gets back: the order number to open once the order exists. */
export type CheckoutResult = ActionResult & { orderNumber?: string };

/**
 * Backend plan 9.1 (B07). The form sends the cart lines as JSON (productSlug, sku, quantity, customization), the
 * delivery address and the idempotency key made when the page opened. Prices and totals are never read from it.
 */
export async function placeOrderAction(_: ActionState, form: FormData): Promise<CheckoutResult> {
  return runAction<CheckoutResult>(async () => {
    const actor = await requireActor();
    const raw = formToObject(form);
    const field = (name: string) => (typeof raw[name] === "string" ? raw[name] : undefined);
    const input = parseInput(checkoutSchema, {
      idempotencyKey: field("idempotencyKey"),
      lines: parseLines(field("lines")),
      shippingAddress: {
        recipientName: field("recipientName"),
        line1: field("line1"),
        line2: field("line2"),
        city: field("city"),
        district: field("district"),
        postalCode: field("postalCode"),
        phone: field("phone"),
      },
    });
    const { order, created } = await placeOrder(actor, input);
    if (created) updateTag(CATALOGUE_TAG); // stock went down
    revalidatePath("/account/orders");
    return { ok: true, orderNumber: order.orderNumber };
  });
}

/** The cart lines field; anything that isn't JSON is an empty cart, which validation then reports. */
function parseLines(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}
