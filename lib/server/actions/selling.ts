"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { applicationSchema } from "@/lib/validation/application";
import { id } from "@/lib/validation/common";
import { orderTransitionSchema } from "@/lib/validation/order";
import { productSchema } from "@/lib/validation/product";
import { payoutSchema, shopSchema } from "@/lib/validation/shop";
import { replySchema } from "@/lib/validation/content";
import { requireActor } from "../auth";
import { refreshCatalogue, refreshPage } from "./refresh";
import { ValidationError } from "../errors";
import { formToObject, parseInput, runAction } from "../run-action";
import { submitApplication, withdrawApplication } from "../services/applications";
import { transitionSellerOrder } from "../services/orders";
import { archiveProduct, restoreProduct, saveProduct } from "../services/products";
import { replyToReview } from "../services/reviews";
import { savePayoutDetails } from "../services/payout-accounts";
import { updateShop } from "../services/shops";

export async function submitApplicationAction(_: ActionState, form: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    const raw = formToObject(form);
    const field = (name: string) => (typeof raw[name] === "string" ? raw[name] : undefined);
    await submitApplication(
      actor,
      parseInput(applicationSchema, {
        ...raw,
        categorySlugs: form.getAll("categorySlugs").map(String),
        workPhotoIds: form.getAll("workPhotoIds").map(String),
        address: {
          line1: field("address.line1"),
          line2: field("address.line2"),
          city: field("address.city"),
          district: field("address.district"),
          postalCode: field("address.postalCode"),
        },
      }),
    );
  });
  if (result.ok) {
    revalidatePath("/account");
    redirect("/sell/apply/submitted");
  }
  return result;
}

export async function withdrawApplicationAction(): Promise<ActionResult> {
  return runAction(async () => {
    await withdrawApplication(await requireActor());
    revalidatePath("/account");
    return { ok: true, message: "Your application was withdrawn." };
  });
}

export async function updateShopAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formToObject(form);
    const input = parseInput(shopSchema, {
      ...raw,
      logo: { id: raw["logo.id"], alt: raw["logo.alt"] },
      banner: { id: raw["banner.id"], alt: raw["banner.alt"] },
    });
    const shop = await updateShop(actor, input);
    // The shop's name and details show on every list and item page: rare enough to refresh the whole catalogue.
    refreshCatalogue({ kind: "everything" });
    return { ok: true, message: shop.status === "ACTIVE" ? "Shop saved. It’s live on CeyLiving." : "Shop saved." };
  });
}

export async function savePayoutAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await savePayoutDetails(actor, parseInput(payoutSchema, formToObject(form)));
    // Nothing public changes (a shop going live queues its own catalogue refresh, lib/server/services/shops.ts).
    refreshPage();
    return { ok: true, message: "Payout details saved. Your account number is stored encrypted." };
  });
}

/** The item form sends its fields as one JSON payload; the server validates every part (SEC-A3). */
export async function saveProductAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const intent = form.get("intent") === "submit" ? "submit" : "draft";
    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload") ?? ""));
    } catch {
      throw new ValidationError("The form couldn’t be read. Reload the page and try again.");
    }
    const productId = form.get("productId") ? parseInput(id, form.get("productId")) : undefined;
    const product = await saveProduct(actor, parseInput(productSchema(intent), payload), intent, productId);
    refreshCatalogue({
      kind: "product",
      productId: product.id,
      shopSlug: product.shopSlug,
      categorySlug: product.categorySlug,
    });
    const messages = {
      DRAFT: "Draft saved.",
      PENDING_REVIEW: "Submitted. We’ll review it shortly; you’ll get a notification.",
      ACTIVE: "Published. It’s on sale now.",
    } as const;
    return { ok: true, message: messages[product.status as keyof typeof messages] ?? "Saved." };
  });
}

export async function archiveProductAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const productId = parseInput(id, form.get("productId"));
    const product =
      form.get("restore") === "1" ? await restoreProduct(actor, productId) : await archiveProduct(actor, productId);
    refreshCatalogue({
      kind: "product",
      productId: product.id,
      shopSlug: product.shopSlug,
      categorySlug: product.categorySlug,
    });
    return { ok: true, message: form.get("restore") === "1" ? "Moved back to drafts." : "Archived." };
  });
}

export async function transitionOrderAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const so = await transitionSellerOrder(actor, parseInput(orderTransitionSchema, formToObject(form)));
    revalidatePath("/seller", "layout");
    revalidatePath("/account", "layout");
    return { ok: true, message: `Order updated: ${so.status.toLowerCase().replace("_", " ")}.` };
  });
}

export async function replyToReviewAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(replySchema, formToObject(form));
    const review = await replyToReview(actor, input.reviewId, input.body);
    refreshCatalogue({ kind: "review", productId: review.productId, shopId: review.shopId });
    return { ok: true, message: "Reply posted." };
  });
}
