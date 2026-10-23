"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { addressSchema, profileSchema } from "@/lib/validation/profile";
import { id } from "@/lib/validation/common";
import { requireActor } from "../auth";
import { formToObject, parseInput, runAction } from "../run-action";
import { addAddress, deleteAddress, updateProfile } from "../services/profile";

// Thin actions (feature spec 7.2): who is asking → validate → service → revalidate → result.

export async function updateProfileAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(profileSchema, formToObject(form));
    await updateProfile(actor, input);
    revalidatePath("/account");
    return { ok: true, message: "Your details are saved." };
  });
}

export async function addAddressAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = parseInput(addressSchema, formToObject(form));
    await addAddress(actor, input);
    revalidatePath("/account/addresses");
    return { ok: true, message: "Address saved." };
  });
}

export async function deleteAddressAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteAddress(actor, parseInput(id, form.get("addressId")));
    revalidatePath("/account/addresses");
    return { ok: true, message: "Address deleted." };
  });
}
