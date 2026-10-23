import "server-only";
import { COMMISSION_RATE_BPS, PAYOUT_HOLD_DAYS } from "@/lib/config";
import type { Payout, SellerOrder, Shop } from "@/lib/types";
import { ConflictError, NotFoundError } from "../errors";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { readStore, transaction, type StoreData } from "../store/dev-store";
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
function payableOrders(db: StoreData, now: Date): SellerOrder[] {
  return db.sellerOrders.filter(
    (so) => so.status === "COMPLETED" && !so.payoutId && (payableFrom(so)?.getTime() ?? Infinity) <= now.getTime(),
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
  return transaction((db) => {
    const byShop = new Map<string, SellerOrder[]>();
    payableOrders(db, now).forEach((so) => byShop.set(so.shopId, [...(byShop.get(so.shopId) ?? []), so]));
    const created: Payout[] = [];
    for (const [shopId, orders] of byShop) {
      const shop = db.shops.find((s) => s.id === shopId);
      if (!shop?.payoutAccountMasked) continue;
      const payout = buildPayout(shop, orders, now);
      db.payouts.push(payout);
      orders.forEach((so) => (so.payoutId = payout.id));
      addNotification(db, shop.ownerId, "payout.scheduled", "A new payout statement is ready", "/seller/payouts");
      audit(db, actor, "payout.generated", "PAYOUT", payout.id, {
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
  return transaction((db) => {
    const payout = db.payouts.find((p) => p.id === payoutId);
    if (!payout) throw new NotFoundError("Payout not found.");
    if (payout.status !== "SCHEDULED") throw new ConflictError("Only scheduled payouts can be marked paid.");
    Object.assign(payout, { status: "PAID", paidAt: now.toISOString(), reference });
    const shop = db.shops.find((s) => s.id === payout.shopId);
    if (shop)
      addNotification(db, shop.ownerId, "payout.paid", "Your payout has been sent to your bank", "/seller/payouts");
    audit(db, actor, "payout.paid", "PAYOUT", payout.id, { reason: `Bank reference ${reference}` });
    return payout;
  });
}

/** FR-13: the seller's own statements, plus earnings still on hold or waiting for the next run. */
export function sellerPayoutSummary(actor: Actor, now = new Date(), db: StoreData = readStore()) {
  const shop = shopOfSeller(actor, db);
  const payouts = db.payouts.filter((p) => p.shopId === shop.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const upcoming = db.sellerOrders
    .filter((so) => so.shopId === shop.id && so.status === "COMPLETED" && !so.payoutId)
    .map((so) => ({
      sellerOrder: so,
      payableFrom: payableFrom(so)!,
      netCents: so.subtotalCents + so.shippingCents - commissionFor(so),
    }));
  const onHold = upcoming.filter((u) => u.payableFrom.getTime() > now.getTime());
  const ready = upcoming.filter((u) => u.payableFrom.getTime() <= now.getTime());
  return { shop, payouts, onHold, ready, rateBps: COMMISSION_RATE_BPS };
}
