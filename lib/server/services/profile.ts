import "server-only";
import type { AddressInput, ProfileInput } from "@/lib/validation/profile";
import { NotFoundError, ValidationError } from "../errors";
import type { Actor } from "../permissions";
import { newId, updateUser } from "../repositories/people";
import { transaction } from "../store/dev-store";

const MAX_ADDRESSES = 5;

/** FR-1: a person edits their own name and phone; the ID always comes from the session. */
export async function updateProfile(actor: Actor, input: ProfileInput) {
  return transaction((db) => updateUser(db, actor.id, { name: input.name, phone: input.phone }));
}

/** FR-12: saved addresses, owned by the signed-in person only. */
export async function addAddress(actor: Actor, input: AddressInput) {
  return transaction((db) => {
    if (db.addresses.filter((a) => a.userId === actor.id).length >= MAX_ADDRESSES) {
      throw new ValidationError(`You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`);
    }
    const address = { id: newId("addr"), userId: actor.id, ...input };
    db.addresses.push(address);
    return address;
  });
}

export async function deleteAddress(actor: Actor, addressId: string) {
  return transaction((db) => {
    const index = db.addresses.findIndex((a) => a.id === addressId && a.userId === actor.id);
    if (index === -1) throw new NotFoundError("We couldn’t find that address.");
    db.addresses.splice(index, 1);
  });
}
