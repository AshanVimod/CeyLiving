"use server";

import type { ActionResult, ActionState } from "@/lib/action-result";
import { decisionSchema } from "@/lib/validation/application";
import {
  moderationSchema,
  officialReplySchema,
  reportResolutionSchema,
  restrictionSchema,
} from "@/lib/validation/content";
import { emailRetrySchema } from "@/lib/validation/more";
import { productDecisionSchema } from "@/lib/validation/product";
import { shopDecisionSchema } from "@/lib/validation/shop";
import { requireActor } from "../auth";
import { refreshCatalogue, refreshPage } from "./refresh";
import { formToObject, parseInput, runAction } from "../run-action";
import { decideApplication } from "../services/applications";
import { retryEmail } from "../services/email-admin";
import { moderateContent, officialReply, resolveReport, restrictUser } from "../services/moderation";
import { decideProduct } from "../services/products";
import { decideShop } from "../services/shops";

// Every admin action: signed in (SEC-A1), validated (SEC-A3), admin role checked in the service,
// reason required where the rules say so, audit row written in the same transaction (SEC-A9).
// BE-09 (B13): each refreshes only the cached catalogue reads its change shows; the rest re-render the admin's page.

export async function decideApplicationAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const app = await decideApplication(await requireActor(), parseInput(decisionSchema, formToObject(form)));
    refreshPage(); // an approved application makes a DRAFT shop, which isn't public yet
    return {
      ok: true,
      message: `Application ${app.status === "NEEDS_CHANGES" ? "sent back for changes" : app.status.toLowerCase()}.`,
    };
  });
}

export async function decideShopAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const shop = await decideShop(await requireActor(), parseInput(shopDecisionSchema, formToObject(form)));
    refreshCatalogue({ kind: "everything" }); // a suspended or reinstated shop leaves or rejoins every list
    return { ok: true, message: `${shop.name} updated.` };
  });
}

export async function decideProductAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const product = await decideProduct(await requireActor(), parseInput(productDecisionSchema, formToObject(form)));
    refreshCatalogue({
      kind: "product",
      productId: product.id,
      shopSlug: product.shopSlug,
      categorySlug: product.categorySlug,
    });
    return { ok: true, message: `“${product.title}” updated.` };
  });
}

export async function moderateAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(moderationSchema, formToObject(form));
    const content = await moderateContent(actor, input);
    // A review shows in cached pages (and at once: serious removals must not wait); questions and answers never do.
    if (input.targetType === "REVIEW" && "rating" in content)
      refreshCatalogue({ kind: "review", productId: content.productId, shopId: content.shopId });
    else refreshPage();
    return {
      ok: true,
      message: `Post ${input.action === "hide" ? "hidden" : input.action === "restore" ? "restored" : "deleted"}.`,
    };
  });
}

export async function officialReplyAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const review = await officialReply(await requireActor(), parseInput(officialReplySchema, formToObject(form)));
    if (review) refreshCatalogue({ kind: "review", productId: review.productId, shopId: review.shopId });
    else refreshPage();
    return { ok: true, message: "Reply posted as the CeyLiving team." };
  });
}

export async function restrictUserAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(restrictionSchema, formToObject(form));
    await restrictUser(actor, input);
    refreshPage();
    return {
      ok: true,
      message:
        input.action === "lift"
          ? "Posting restored."
          : input.action === "ban"
            ? "User banned from posting."
            : `User muted for ${input.days} days.`,
    };
  });
}

export async function resolveReportAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await resolveReport(await requireActor(), parseInput(reportResolutionSchema, formToObject(form)));
    refreshPage();
    return { ok: true, message: "Report closed." };
  });
}

/** B10: queue a stuck email again (/admin/emails). The service checks it is stuck and still worth sending. */
export async function retryEmailAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(emailRetrySchema, formToObject(form));
    await retryEmail(actor, input.deliveryId);
    refreshPage();
    return { ok: true, message: "Queued again. The worker sends it within a minute." };
  });
}
