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
  shopsWithUnpaidCompletedOrders,
  unpaidCompletedSellerOrders,
  updatePayout,
} from "../repositories/commerce";
import { addNotification, newId } from "../repositories/people";
import { audit, JOB_BATCH_SIZE, WORKER } from "./shared";

const DAY = 86_400_000;

/** BR-10: commission = round(items subtotal × rate / 10,000). Delivery fees pass to the seller in full. */
export function commissionFor(sellerOrder: Pick<SellerOrder, "subtotalCents">, rateBps = COMMISSION_RATE_BPS): number {
  return Math.round((sellerOrder.subtotalCents * rateBps) / 10_000);
}

export function payableFrom(sellerOrder: SellerOrder): Date | undefined {
  return sellerOrder.completedAt ? new Date(Date.parse(sellerOrder.completedAt) + PAYOUT_HOLD_DAYS * DAY) : undefined;
}

/** BR-11: the shop's orders that are delivered, past the hold period, and not yet in any payout. */
async function payableOrders(tx: Tx, shopId: string, now: Date): Promise<SellerOrder[]> {
  return (await unpaidCompletedSellerOrders(tx, shopId)).filter(
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
 * BR-11: one shop's payout, in its own transaction. Shops without payout details are skipped and picked up next
 * time. If another run (the admin button and the weekly job at once, or a retried job) linked any of these orders
 * first, setPayoutOnSellerOrders throws, this shop's transaction rolls back and the shop is skipped: an order is
 * never in two payouts.
 */
async function payoutForShop(by: Actor | typeof WORKER, shopId: string, now: Date): Promise<Payout | undefined> {
  try {
    return await withTx(async (tx) => {
      const shop = await findShopById(tx, shopId);
      if (!shop?.payoutAccountMasked) return undefined;
      const orders = await payableOrders(tx, shop.id, now);
      if (!orders.length) return undefined;
      const payout = await insertPayout(tx, buildPayout(shop, orders, now));
      await setPayoutOnSellerOrders(
        tx,
        orders.map((so) => so.id),
        payout.id,
      );
      await addNotification(tx, shop.ownerId, "payout.scheduled", "A new payout statement is ready", "/seller/payouts");
      await audit(tx, by, "payout.generated", "PAYOUT", payout.id, {
        after: { shopId, netCents: payout.netCents, orders: orders.length },
        ...(by === WORKER && { reason: "Weekly payout job (payouts.generateWeekly)" }),
      });
      return payout;
    });
  } catch (error) {
    if (error instanceof ConflictError) return undefined;
    throw error;
  }
}

/**
 * The payout run (BR-11), shared by the admin button and the weekly job (payouts.generateWeekly), so both follow
 * the same rules. Shops are read in pages of JOB_BATCH_SIZE and each gets its own transaction (JOB-06): a crash
 * part-way keeps the payouts already made, and the next run carries on with the rest.
 */
export async function runPayouts(by: Actor | typeof WORKER, now = new Date()): Promise<Payout[]> {
  const created: Payout[] = [];
  let after: string | undefined;
  for (;;) {
    const shopIds = await shopsWithUnpaidCompletedOrders(db, after, JOB_BATCH_SIZE);
    for (const shopId of shopIds) {
      const payout = await payoutForShop(by, shopId, now);
      if (payout) created.push(payout);
    }
    if (shopIds.length < JOB_BATCH_SIZE) return created;
    after = shopIds.at(-1);
  }
}

/** The admin's "Generate payouts" button: a manual run of the weekly job. */
export async function generatePayouts(actor: Actor, now = new Date()): Promise<Payout[]> {
  assertRole(actor, ["ADMIN"]);
  return runPayouts(actor, now);
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
