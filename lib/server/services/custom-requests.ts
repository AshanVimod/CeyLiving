import "server-only";
import { CUSTOM_REQUEST_EXPIRY_DAYS } from "@/lib/config";
import type { CustomRequest, CustomRequestStatus } from "@/lib/types";
import type { CustomRequestInput, QuoteInput } from "@/lib/validation/more";
import { db, withTx, type Tx } from "../db/tx";
import { ForbiddenError, NotFoundError } from "../errors";
import { assertCanPost, shopOfSeller, type Actor } from "../permissions";
import { findShopById } from "../repositories/catalogue";
import {
  customRequestsOfCustomer,
  customRequestsOfShop,
  findCustomRequest,
  insertCustomRequest,
  updateCustomRequest,
} from "../repositories/commerce";
import { addNotification, newId } from "../repositories/people";
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

/** Loads a request inside a transaction, recording the expiry if it has gone stale. */
async function load(tx: Tx, id: string, now: Date): Promise<CustomRequest> {
  const request = await findCustomRequest(tx, id);
  if (!request) throw new NotFoundError("Request not found.");
  if (effectiveStatus(request, now) === "EXPIRED" && request.status !== "EXPIRED")
    return (await updateCustomRequest(tx, id, { status: "EXPIRED" }))!;
  return request;
}

/** A signed-in customer asks an active shop for something made to order (not their own shop). */
export async function createCustomRequest(
  actor: Actor,
  input: CustomRequestInput,
  now = new Date(),
): Promise<CustomRequest> {
  assertCanPost(actor, now);
  return withTx(async (tx) => {
    const shop = await findShopById(tx, input.shopId);
    if (!shop || shop.status !== "ACTIVE") throw new NotFoundError("That maker isn’t taking requests right now.");
    if (shop.ownerId === actor.id) throw new ForbiddenError("You can’t send a request to your own shop.");
    await assertRateLimit(tx, actor.id, "customRequest", now);
    const request = await insertCustomRequest(tx, {
      id: newId("req"),
      customerId: actor.id,
      customerName: actor.name,
      shopId: shop.id,
      message: input.message,
      budgetCents: input.budget,
      status: "OPEN",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await addNotification(
      tx,
      shop.ownerId,
      "request.created",
      `New custom request from ${actor.name}`,
      "/seller/requests",
    );
    return request;
  });
}

/** The shop's seller sends a price and time (RULE-S1: the shop comes from the session, not the form). */
export async function quoteCustomRequest(actor: Actor, input: QuoteInput, now = new Date()): Promise<CustomRequest> {
  return withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    const request = await load(tx, input.requestId, now);
    if (request.shopId !== shop.id) throw new NotFoundError("Request not found.");
    assertTransition(FLOW, request.status, "QUOTED", "request");
    const updated = (await updateCustomRequest(tx, request.id, {
      status: "QUOTED",
      quote: { priceCents: input.price, days: input.days, message: input.message, quotedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    }))!;
    await addNotification(
      tx,
      request.customerId,
      "request.quoted",
      `${shop.name} sent you a quote`,
      "/account/requests",
    );
    return updated;
  });
}

export async function declineCustomRequest(
  actor: Actor,
  requestId: string,
  reason: string,
  now = new Date(),
): Promise<CustomRequest> {
  return withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    const request = await load(tx, requestId, now);
    if (request.shopId !== shop.id) throw new NotFoundError("Request not found.");
    assertTransition(FLOW, request.status, "DECLINED", "request");
    const updated = (await updateCustomRequest(tx, request.id, {
      status: "DECLINED",
      declineReason: reason,
      updatedAt: now.toISOString(),
    }))!;
    await addNotification(
      tx,
      request.customerId,
      "request.declined",
      `${shop.name} can’t take on your request`,
      "/account/requests",
    );
    return updated;
  });
}

/** The customer accepts or declines a quote on their own request. */
export async function respondToQuote(
  actor: Actor,
  requestId: string,
  response: "accept" | "decline",
  now = new Date(),
): Promise<CustomRequest> {
  return withTx(async (tx) => {
    const request = await load(tx, requestId, now);
    if (request.customerId !== actor.id) throw new NotFoundError("Request not found.");
    const to: CustomRequestStatus = response === "accept" ? "ACCEPTED" : "DECLINED";
    if (request.status !== "QUOTED") throw new NotFoundError("There’s no quote to answer on this request.");
    assertTransition(FLOW, request.status, to, "request");
    const updated = (await updateCustomRequest(tx, request.id, { status: to, updatedAt: now.toISOString() }))!;
    const shop = await findShopById(tx, request.shopId);
    if (shop)
      await addNotification(
        tx,
        shop.ownerId,
        `request.${response}ed`,
        `${actor.name} ${response === "accept" ? "accepted" : "declined"} your quote`,
        "/seller/requests",
      );
    return updated;
  });
}

export async function requestsOfCustomer(actor: Actor, tx: Tx = db): Promise<CustomRequest[]> {
  return customRequestsOfCustomer(tx, actor.id);
}

export async function requestsOfSeller(actor: Actor, tx: Tx = db): Promise<CustomRequest[]> {
  const shop = await shopOfSeller(actor, tx);
  return customRequestsOfShop(tx, shop.id);
}
