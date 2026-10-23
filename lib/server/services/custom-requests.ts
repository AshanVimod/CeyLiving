import "server-only";
import { CUSTOM_REQUEST_EXPIRY_DAYS } from "@/lib/config";
import type { CustomRequest, CustomRequestStatus } from "@/lib/types";
import type { CustomRequestInput, QuoteInput } from "@/lib/validation/more";
import { ForbiddenError, NotFoundError } from "../errors";
import { assertCanPost, shopOfSeller, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { readStore, transaction, type StoreData } from "../store/dev-store";
import { assertRateLimit, assertTransition } from "./shared";

// FR-14 status flow: OPEN → QUOTED → ACCEPTED / DECLINED; open or quoted requests expire after 14 days.
const FLOW: Partial<Record<CustomRequestStatus, readonly CustomRequestStatus[]>> = {
  OPEN: ["QUOTED", "DECLINED", "EXPIRED"],
  QUOTED: ["ACCEPTED", "DECLINED", "EXPIRED"],
};

/** Status as people should see it: stale open or quoted requests count as expired. */
export function effectiveStatus(request: CustomRequest, now = new Date()): CustomRequestStatus {
  const stale = now.getTime() - Date.parse(request.updatedAt) > CUSTOM_REQUEST_EXPIRY_DAYS * 86_400_000;
  return stale && (request.status === "OPEN" || request.status === "QUOTED") ? "EXPIRED" : request.status;
}

function load(db: StoreData, id: string, now: Date): CustomRequest {
  const request = db.customRequests.find((r) => r.id === id);
  if (!request) throw new NotFoundError("Request not found.");
  if (effectiveStatus(request, now) === "EXPIRED") request.status = "EXPIRED";
  return request;
}

/** A signed-in customer asks an active shop for something made to order (not their own shop). */
export async function createCustomRequest(actor: Actor, input: CustomRequestInput, now = new Date()): Promise<CustomRequest> {
  assertCanPost(actor, now);
  return transaction((db) => {
    const shop = db.shops.find((s) => s.id === input.shopId && s.status === "ACTIVE");
    if (!shop) throw new NotFoundError("That maker isn’t taking requests right now.");
    if (shop.ownerId === actor.id) throw new ForbiddenError("You can’t send a request to your own shop.");
    assertRateLimit(db, actor.id, "customRequest", now);
    const request: CustomRequest = {
      id: newId("req"),
      customerId: actor.id,
      customerName: actor.name,
      shopId: shop.id,
      message: input.message,
      budgetCents: input.budget,
      status: "OPEN",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    db.customRequests.push(request);
    addNotification(db, shop.ownerId, "request.created", `New custom request from ${actor.name}`, "/seller/requests");
    return request;
  });
}

/** The shop's seller sends a price and time (RULE-S1: the shop comes from the session, not the form). */
export async function quoteCustomRequest(actor: Actor, input: QuoteInput, now = new Date()): Promise<CustomRequest> {
  return transaction((db) => {
    const shop = shopOfSeller(actor, db);
    const request = load(db, input.requestId, now);
    if (request.shopId !== shop.id) throw new NotFoundError("Request not found.");
    assertTransition(FLOW, request.status, "QUOTED", "request");
    Object.assign(request, { status: "QUOTED", quote: { priceCents: input.price, days: input.days, message: input.message, quotedAt: now.toISOString() }, updatedAt: now.toISOString() });
    addNotification(db, request.customerId, "request.quoted", `${shop.name} sent you a quote`, "/account/requests");
    return request;
  });
}

export async function declineCustomRequest(actor: Actor, requestId: string, reason: string, now = new Date()): Promise<CustomRequest> {
  return transaction((db) => {
    const shop = shopOfSeller(actor, db);
    const request = load(db, requestId, now);
    if (request.shopId !== shop.id) throw new NotFoundError("Request not found.");
    assertTransition(FLOW, request.status, "DECLINED", "request");
    Object.assign(request, { status: "DECLINED", declineReason: reason, updatedAt: now.toISOString() });
    addNotification(db, request.customerId, "request.declined", `${shop.name} can’t take on your request`, "/account/requests");
    return request;
  });
}

/** The customer accepts or declines a quote on their own request. */
export async function respondToQuote(actor: Actor, requestId: string, response: "accept" | "decline", now = new Date()): Promise<CustomRequest> {
  return transaction((db) => {
    const request = load(db, requestId, now);
    if (request.customerId !== actor.id) throw new NotFoundError("Request not found.");
    const to: CustomRequestStatus = response === "accept" ? "ACCEPTED" : "DECLINED";
    if (request.status !== "QUOTED") throw new NotFoundError("There’s no quote to answer on this request.");
    assertTransition(FLOW, request.status, to, "request");
    Object.assign(request, { status: to, updatedAt: now.toISOString() });
    const shop = db.shops.find((s) => s.id === request.shopId);
    if (shop) addNotification(db, shop.ownerId, `request.${response}ed`, `${actor.name} ${response === "accept" ? "accepted" : "declined"} your quote`, "/seller/requests");
    return request;
  });
}

export function requestsOfCustomer(actor: Actor, db: StoreData = readStore()): CustomRequest[] {
  return db.customRequests.filter((r) => r.customerId === actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function requestsOfSeller(actor: Actor, db: StoreData = readStore()): CustomRequest[] {
  const shop = shopOfSeller(actor, db);
  return db.customRequests.filter((r) => r.shopId === shop.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
