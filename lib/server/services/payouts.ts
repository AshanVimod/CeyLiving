import "server-only";
import { COMMISSION_RATE_BPS, PAYOUT_HOLD_DAYS } from "@/lib/config";
import type { Payout, SellerOrder, Shop } from "@/lib/types";
import { ConflictError, NotFoundError } from "../errors";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import { db, withTx, type Tx } from "../db/tx";
import { findShopById } from "../repositories/catalogue";
import {
  findPayout,
  insertPayout,
  payoutsOfShop,
  setPayoutOnSellerOrders,
  unpaidCompletedSellerOrders,
  updatePayout,
} from "../repositories/commerce";
import { addNotification, newId } from "../repositories/people";
import { audit } from "./shared";

const DAY = 86_400_000;

/** BR-10: commission = round(items subtotal × rate / 10,000). Delivery fees pass to the seller in full. */
export function commissionFor(sellerOrder: Pick<SellerOrder, "subtotalCents">, rateBps = COMMISSION_RATE_BPS): number {
  return Math.round((sellerOrder.subtotalCents * rateBps) / 10_000);
}

export function payableFrom(sellerOrder: SellerOrder): Date | undefined {
  return sellerOrder.completedAt ? new Date(Date.parse(sellerOrder.completedAt) + PAYOUT_HOLD_DAYS * DAY) : undefined;
}

/** BR-11: delivered, past the hold period, and not yet in any payout. */
async function payableOrders(tx: Tx, now: Date): Promise<SellerOrder[]> {
  return (await unpaidCompletedSellerOrders(tx)).filter(
    (so) => (payableFrom(so)?.getTime() ?? Infinity) <= now.getTime(),
  );
}

function buildPayout(shop: Shop, orders: SellerOrder[], now: Date): Payout {
  const grossCents = orders.reduce((s, so) => s + so.subtotalCents + so.shippingCents, 0);
  const commissionCents = orders.reduce((s, so) => s + commissionFor(so), 0);
  const periodStart = orders.map((so) => so.completedAt!).sort()[0]!;
  return {
    id: newId("payout"),
    shopId: shop.id,
    periodStart,
    periodEnd: now.toISOString(),
    sellerOrderIds: orders.map((so) => so.id),
    grossCents,
    commissionCents,
    refundsCents: 0,
    netCents: grossCents - commissionCents,
    status: "SCHEDULED",
    createdAt: now.toISOString(),
  };
}

/**
 * The weekly payout job (BR-11). Run by an admin until a background worker exists.
 * Shops without payout details are skipped and picked up next time.
 */
export async function generatePayouts(actor: Actor, now = new Date()): Promise<Payout[]> {
  assertRole(actor, ["ADMIN"]);
  return withTx(async (tx) => {
    const byShop = new Map<string, SellerOrder[]>();
    (await payableOrders(tx, now)).forEach((so) => byShop.set(so.shopId, [...(byShop.get(so.shopId) ?? []), so]));
    const created: Payout[] = [];
    for (const [shopId, orders] of byShop) {
      const shop = await findShopById(tx, shopId);
      if (!shop?.payoutAccountMasked) continue;
      const payout = await insertPayout(tx, buildPayout(shop, orders, now));
      await setPayoutOnSellerOrders(
        tx,
        orders.map((so) => so.id),
        payout.id,
      );
      await addNotification(tx, shop.ownerId, "payout.scheduled", "A new payout statement is ready", "/seller/payouts");
      await audit(tx, actor, "payout.generated", "PAYOUT", payout.id, {
        after: { shopId, netCents: payout.netCents, orders: orders.length },
      });
      created.push(payout);
    }
    return created;
  });
}

/** An admin records the bank transfer; the reference is kept for reconciliation (SEC-A9 audit). */
export async function markPayoutPaid(
  actor: Actor,
  payoutId: string,
  reference: string,
  now = new Date(),
): Promise<Payout> {
  assertRole(actor, ["ADMIN"]);
  return withTx(async (tx) => {
    const payout = await findPayout(tx, payoutId);
    if (!payout) throw new NotFoundError("Payout not found.");
    // DB-06: only a SCHEDULED payout can be marked paid, so a double click can't record two transfers.
    const paid = await updatePayout(
      tx,
      payout.id,
      { status: "PAID", paidAt: now.toISOString(), reference },
      { from: "SCHEDULED" },
    );
    if (!paid) throw new ConflictError("Only scheduled payouts can be marked paid.");
    const shop = await findShopById(tx, payout.shopId);
    if (shop)
      await addNotification(
        tx,
        shop.ownerId,
        "payout.paid",
        "Your payout has been sent to your bank",
        "/seller/payouts",
      );
    await audit(tx, actor, "payout.paid", "PAYOUT", payout.id, { reason: `Bank reference ${reference}` });
    return paid;
  });
}

/** FR-13: the seller's own statements, plus earnings still on hold or waiting for the next run. */
export async function sellerPayoutSummary(actor: Actor, now = new Date(), tx: Tx = db) {
  const shop = await shopOfSeller(actor, tx);
  const payouts = await payoutsOfShop(tx, shop.id);
  const upcoming = (await unpaidCompletedSellerOrders(tx, shop.id)).map((so) => ({
    sellerOrder: so,
    payableFrom: payableFrom(so)!,
    netCents: so.subtotalCents + so.shippingCents - commissionFor(so),
  }));
  const onHold = upcoming.filter((u) => u.payableFrom.getTime() > now.getTime());
  const ready = upcoming.filter((u) => u.payableFrom.getTime() <= now.getTime());
  return { shop, payouts, onHold, ready, rateBps: COMMISSION_RATE_BPS };
}
