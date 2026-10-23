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
import { ValidationError } from "../errors";
import { formToObject, parseInput, runAction } from "../run-action";
import { submitApplication, withdrawApplication } from "../services/applications";
import { transitionSellerOrder } from "../services/orders";
import { archiveProduct, restoreProduct, saveProduct } from "../services/products";
import { replyToReview } from "../services/reviews";
import { savePayoutDetails, updateShop } from "../services/shops";

/** Catalogue-wide changes (shop or item visibility) refresh every page. */
function refreshCatalogue() {
  revalidatePath("/", "layout");
}

export async function submitApplicationAction(_: ActionState, form: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    const raw = formToObject(form);
    const photos = form.getAll("workPhotoUrls").map(String);
    await submitApplication(actor, parseInput(applicationSchema, { ...raw, workPhotoUrls: photos }));
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
      logo: { url: raw["logo.url"], alt: raw["logo.alt"] },
      banner: { url: raw["banner.url"], alt: raw["banner.alt"] },
    });
    const shop = await updateShop(actor, input);
    refreshCatalogue();
    return { ok: true, message: shop.status === "ACTIVE" ? "Shop saved. It’s live on CeyLiving." : "Shop saved." };
  });
}

export async function savePayoutAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await savePayoutDetails(actor, parseInput(payoutSchema, formToObject(form)));
    refreshCatalogue();
    return { ok: true, message: "Payout details saved. Only the last four digits are kept." };
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
    refreshCatalogue();
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
    if (form.get("restore") === "1") await restoreProduct(actor, productId);
    else await archiveProduct(actor, productId);
    refreshCatalogue();
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
    await replyToReview(actor, input.reviewId, input.body);
    refreshCatalogue();
    return { ok: true, message: "Reply posted." };
  });
}
