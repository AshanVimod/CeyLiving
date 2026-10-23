"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { DEMO_SESSION_COOKIE } from "@/lib/session";
import {
  customRequestSchema,
  declineRequestSchema,
  deleteAccountSchema,
  payoutPaidSchema,
  quoteResponseSchema,
  quoteSchema,
  roleChangeSchema,
  voteSchema,
} from "@/lib/validation/more";
import { requireActor } from "../auth";
import { formToObject, parseInput, runAction } from "../run-action";
import { changeRole, toggleHelpful } from "../services/community-extras";
import {
  createCustomRequest,
  declineCustomRequest,
  quoteCustomRequest,
  respondToQuote,
} from "../services/custom-requests";
import { generatePayouts, markPayoutPaid } from "../services/payouts";
import { deleteMyAccount } from "../services/privacy";

// FR-13, FR-14, FR-16, FR-17, FR-19. Same shape as every action: who → validate → service → refresh.

export async function createCustomRequestAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await createCustomRequest(actor, parseInput(customRequestSchema, formToObject(form)));
    revalidatePath("/account/requests");
    revalidatePath("/seller/requests");
    return {
      ok: true,
      message:
        "Request sent. The maker usually replies within three working days; you’ll find the reply under My account → Requests.",
    };
  });
}

export async function quoteRequestAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await quoteCustomRequest(actor, parseInput(quoteSchema, formToObject(form)));
    revalidatePath("/", "layout");
    return { ok: true, message: "Quote sent." };
  });
}

export async function declineRequestAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(declineRequestSchema, formToObject(form));
    await declineCustomRequest(actor, input.requestId, input.reason);
    revalidatePath("/", "layout");
    return { ok: true, message: "Request declined." };
  });
}

export async function respondToQuoteAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(quoteResponseSchema, formToObject(form));
    await respondToQuote(actor, input.requestId, input.response);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        input.response === "accept" ? "Quote accepted. The maker will list it for you to buy." : "Quote declined.",
    };
  });
}

export async function changeRoleAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await changeRole(actor, parseInput(roleChangeSchema, formToObject(form)));
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Role changed." };
  });
}

export async function toggleHelpfulAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const result = await toggleHelpful(actor, parseInput(voteSchema, formToObject(form)));
    revalidatePath("/", "layout");
    return { ok: true, message: result.voted ? "Marked as helpful." : "Vote removed." };
  });
}

export async function generatePayoutsAction(): Promise<ActionResult> {
  return runAction(async () => {
    const created = await generatePayouts(await requireActor());
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: created.length ? `${created.length} payout statement(s) created.` : "Nothing is ready to pay out yet.",
    };
  });
}

export async function markPayoutPaidAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(payoutPaidSchema, formToObject(form));
    await markPayoutPaid(actor, input.payoutId, input.reference);
    revalidatePath("/", "layout");
    return { ok: true, message: "Marked as paid." };
  });
}

/** FR-17: anonymise the account, end the session and go home. */
export async function deleteAccountAction(_: ActionState, form: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    parseInput(deleteAccountSchema, formToObject(form));
    await deleteMyAccount(actor);
  });
  if (!result.ok) return result;
  (await cookies()).delete(DEMO_SESSION_COOKIE);
  redirect("/signin?deleted=1");
}
