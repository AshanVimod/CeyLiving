"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { id } from "@/lib/validation/common";
import { answerSchema, editReviewSchema, questionSchema, reportSchema, reviewSchema } from "@/lib/validation/content";
import { requireActor } from "../auth";
import { formToObject, parseInput, runAction } from "../run-action";
import { reportContent } from "../services/moderation";
import { markNotificationsRead } from "../services/notifications";
import { confirmDelivery } from "../services/orders";
import { answerQuestion, askQuestion } from "../services/questions";
import { createReview, editReview } from "../services/reviews";

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function askQuestionAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await askQuestion(actor, parseInput(questionSchema, formToObject(form)));
    refreshAll();
    return { ok: true, message: "Question sent. The maker will answer here, and we’ll let you know." };
  });
}

export async function answerQuestionAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await answerQuestion(actor, parseInput(answerSchema, formToObject(form)));
    refreshAll();
    return { ok: true, message: "Answer posted." };
  });
}

export async function createReviewAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await createReview(actor, parseInput(reviewSchema, formToObject(form)));
    refreshAll();
    return { ok: true, message: "Thanks! Your review is posted." };
  });
}

export async function editReviewAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await editReview(actor, parseInput(editReviewSchema, formToObject(form)));
    refreshAll();
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
    refreshAll();
    return { ok: true, message: "Thanks for reporting. Our team will review it." };
  });
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return runAction(async () => {
    await markNotificationsRead(await requireActor());
    revalidatePath("/", "layout");
    return { ok: true, message: "All caught up." };
  });
}
