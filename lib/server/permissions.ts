import "server-only";
import type { Role, Shop, User } from "@/lib/types";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { findShopByOwner } from "./repositories/catalogue";
import type { Tx } from "./db/tx";

export type Actor = User;

// Pure permission checks used by every service (SEC-A1, SEC-A2). They never trust IDs from the browser.

export function assertSignedIn(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw new UnauthorizedError();
}

export function assertRole(actor: Actor, roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new ForbiddenError();
}

/** RULE-S1: the seller's shop, loaded by owner. Sellers without a shop get 404. */
export async function shopOfSeller(actor: Actor, tx: Tx): Promise<Shop> {
  assertRole(actor, ["SELLER"]);
  const shop = await findShopByOwner(tx, actor.id);
  if (!shop) throw new NotFoundError("You don’t have a shop yet.");
  return shop;
}

/** Throws 404 (not 403) when the shop isn't the actor's, so other shops' data isn't revealed (SEC-A5). */
export async function assertShopOwner(actor: Actor, shopId: string, tx: Tx): Promise<Shop> {
  const shop = actor.role === "SELLER" ? await findShopByOwner(tx, actor.id) : undefined;
  if (!shop || shop.id !== shopId) throw new NotFoundError();
  return shop;
}

/** RULE-M3: muted or banned people can still buy and read, but can't post. */
export function canPost(actor: Actor, now = new Date()): boolean {
  if (actor.postingRestriction === "BANNED") return false;
  if (actor.postingRestriction === "MUTED") return !actor.mutedUntil || new Date(actor.mutedUntil) <= now;
  return true;
}

export function assertCanPost(actor: Actor, now = new Date()): void {
  if (canPost(actor, now)) return;
  const until =
    actor.postingRestriction === "MUTED" && actor.mutedUntil
      ? ` until ${new Date(actor.mutedUntil).toLocaleDateString("en-LK", { day: "numeric", month: "long", timeZone: "Asia/Colombo" })}`
      : "";
  throw new ForbiddenError(`Your account can’t post reviews or questions${until}. You can still shop as usual.`);
}
