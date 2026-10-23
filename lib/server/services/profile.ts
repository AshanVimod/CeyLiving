import "server-only";
import type { AddressInput, ProfileInput } from "@/lib/validation/profile";
import { withTx } from "../db/tx";
import { NotFoundError, ValidationError } from "../errors";
import type { Actor } from "../permissions";
import {
  addressesOf,
  deleteAddress as deleteAddressRow,
  insertAddress,
  newId,
  updateUser,
} from "../repositories/people";

const MAX_ADDRESSES = 5;

/** FR-1: a person edits their own name and phone; the ID always comes from the session. */
export async function updateProfile(actor: Actor, input: ProfileInput) {
  return withTx((tx) => updateUser(tx, actor.id, { name: input.name, phone: input.phone }));
}

/** FR-12: saved addresses, owned by the signed-in person only. */
export async function addAddress(actor: Actor, input: AddressInput) {
  return withTx(async (tx) => {
    if ((await addressesOf(tx, actor.id)).length >= MAX_ADDRESSES) {
      throw new ValidationError(`You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`);
    }
    return insertAddress(tx, { id: newId("addr"), userId: actor.id, ...input });
  });
}

export async function deleteAddress(actor: Actor, addressId: string) {
  return withTx(async (tx) => {
    if (!(await deleteAddressRow(tx, addressId, actor.id))) throw new NotFoundError("We couldn’t find that address.");
  });
}
