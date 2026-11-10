"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { answerSchema, editReviewSchema, questionSchema, reportSchema, reviewSchema } from "@/lib/validation/content";
import { requireActor } from "../auth";
import { refreshCatalogue, refreshPage } from "./refresh";
import { formToObject, parseInput, runAction } from "../run-action";
import { reportContent } from "../services/moderation";
import { markNotificationsRead } from "../services/notifications";
import { confirmDelivery } from "../services/orders";
import { answerQuestion, askQuestion } from "../services/questions";
import { createReview, editReview } from "../services/reviews";

// BE-09 (B13): questions, answers, votes and reports are read fresh on every visit, never cached, so those actions
// only re-render the person's page. Reviews feed cached pages, so they refresh the item's and the shop's tags.

export async function askQuestionAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await askQuestion(actor, parseInput(questionSchema, formToObject(form)));
    refreshPage();
    return { ok: true, message: "Question sent. The maker will answer here, and we’ll let you know." };
  });
}

export async function answerQuestionAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await answerQuestion(actor, parseInput(answerSchema, formToObject(form)));
    refreshPage();
    return { ok: true, message: "Answer posted." };
  });
}

export async function createReviewAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const review = await createReview(actor, parseInput(reviewSchema, formToObject(form)));
    refreshCatalogue({ kind: "review", productId: review.productId, shopId: review.shopId });
    return { ok: true, message: "Thanks! Your review is posted." };
  });
}

export async function editReviewAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const review = await editReview(actor, parseInput(editReviewSchema, formToObject(form)));
    refreshCatalogue({ kind: "review", productId: review.productId, shopId: review.shopId });
    return { ok: true, message: "Review updated." };
  });
}

export async function confirmDeliveryAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await confirmDelivery(actor, parseInput(id, form.get("sellerOrderId")));
    revalidatePath("/account", "layout");
    revalidatePath("/seller", "layout");
    return { ok: true, message: "Thanks for confirming. You can now review what you bought." };
  });
}

export async function reportAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await reportContent(actor, parseInput(reportSchema, formToObject(form)));
    refreshPage(); // enough reports hide the post through the worker, which refreshes the catalogue itself
    return { ok: true, message: "Thanks for reporting. Our team will review it." };
  });
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return runAction(async () => {
    await markNotificationsRead(await requireActor());
    refreshPage(); // the bell is read fresh on every page; no cached page changes
    return { ok: true, message: "All caught up." };
  });
}
