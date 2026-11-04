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
import { refreshEverything } from "./refresh";
import { formToObject, parseInput, runAction } from "../run-action";
import { decideApplication } from "../services/applications";
import { retryEmail } from "../services/email-admin";
import { moderateContent, officialReply, resolveReport, restrictUser } from "../services/moderation";
import { decideProduct } from "../services/products";
import { decideShop } from "../services/shops";

// Every admin action: signed in (SEC-A1), validated (SEC-A3), admin role checked in the service,
// reason required where the rules say so, audit row written in the same transaction (SEC-A9).

const refreshAll = refreshEverything;

export async function decideApplicationAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const app = await decideApplication(await requireActor(), parseInput(decisionSchema, formToObject(form)));
    refreshAll();
    return {
      ok: true,
      message: `Application ${app.status === "NEEDS_CHANGES" ? "sent back for changes" : app.status.toLowerCase()}.`,
    };
  });
}

export async function decideShopAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const shop = await decideShop(await requireActor(), parseInput(shopDecisionSchema, formToObject(form)));
    refreshAll();
    return { ok: true, message: `${shop.name} updated.` };
  });
}

export async function decideProductAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const product = await decideProduct(await requireActor(), parseInput(productDecisionSchema, formToObject(form)));
    refreshAll();
    return { ok: true, message: `“${product.title}” updated.` };
  });
}

export async function moderateAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(moderationSchema, formToObject(form));
    await moderateContent(actor, input);
    refreshAll();
    return {
      ok: true,
      message: `Post ${input.action === "hide" ? "hidden" : input.action === "restore" ? "restored" : "deleted"}.`,
    };
  });
}

export async function officialReplyAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await officialReply(await requireActor(), parseInput(officialReplySchema, formToObject(form)));
    refreshAll();
    return { ok: true, message: "Reply posted as the CeyLiving team." };
  });
}

export async function restrictUserAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(restrictionSchema, formToObject(form));
    await restrictUser(actor, input);
    refreshAll();
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
    refreshAll();
    return { ok: true, message: "Report closed." };
  });
}

/** B10: queue a stuck email again (/admin/emails). The service checks it is stuck and still worth sending. */
export async function retryEmailAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(emailRetrySchema, formToObject(form));
    await retryEmail(actor, input.deliveryId);
    refreshAll();
    return { ok: true, message: "Queued again. The worker sends it within a minute." };
  });
}
