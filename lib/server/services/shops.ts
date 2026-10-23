import "server-only";
import { TEXT_LIMITS } from "@/lib/config";
import type { Shop, ShopStatus } from "@/lib/types";
import { photoIdFromUrl } from "@/lib/validation/photo";
import type { PayoutInput, ShopDecisionInput, ShopInput } from "@/lib/validation/shop";
import { db, withTx, type Tx } from "../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import {
  archiveProductsOfShopSlug,
  findShopById,
  findShopBySlug,
  moveProductsToShopSlug,
  productsOfShopSlug,
  updateShop as updateShopRow,
} from "../repositories/catalogue";
import { sellerOrdersOfShop } from "../repositories/commerce";
import { addNotification, updateUser } from "../repositories/people";
import { assertTransition, audit, staleStatus } from "./shared";

// Feature spec 8.2: shop status flow.
const FLOW: Partial<Record<ShopStatus, readonly ShopStatus[]>> = {
  DRAFT: ["ACTIVE", "CLOSED"],
  ACTIVE: ["SUSPENDED", "CLOSED"],
  SUSPENDED: ["ACTIVE", "CLOSED"],
};

const OPEN_ORDER = ["NEW", "ACCEPTED", "IN_PROGRESS", "DISPATCHED"];

export const hasPhoto = (p: { id: string } | undefined) => Boolean(p?.id);

export interface Checklist {
  profileComplete: boolean;
  firstItem: boolean;
  payoutAdded: boolean;
}

/** FR-2b set-up checklist; RULE-S3 decides when a DRAFT shop can go public. */
export async function shopChecklist(shop: Shop, tx: Tx = db): Promise<Checklist> {
  const products = await productsOfShopSlug(tx, shop.slug);
  return {
    profileComplete:
      hasPhoto(shop.logo) &&
      hasPhoto(shop.banner) &&
      shop.story.length >= TEXT_LIMITS.storyMin &&
      Boolean(shop.district && shop.dispatchDays && shop.returnPolicy),
    firstItem: products.some((p) => p.status === "ACTIVE" || p.status === "PENDING_REVIEW"),
    payoutAdded: Boolean(shop.payoutAccountMasked),
  };
}

/** Moves a DRAFT shop to ACTIVE once every checklist item is done (RULE-S3). */
export async function activateIfReady(tx: Tx, shopId: string): Promise<void> {
  const shop = await findShopById(tx, shopId);
  if (!shop || shop.status !== "DRAFT") return;
  const c = await shopChecklist(shop, tx);
  if (c.profileComplete && c.firstItem && c.payoutAdded) {
    await updateShopRow(tx, shop.id, { status: "ACTIVE", updatedAt: new Date().toISOString() }, { from: "DRAFT" });
    await addNotification(tx, shop.ownerId, "shop.active", "Your shop is now live on CeyLiving", `/shop/${shop.slug}`);
  }
}

/** FR-2b: the seller edits their own shop, always loaded by owner (RULE-S1). */
export async function updateShop(actor: Actor, input: ShopInput): Promise<Shop> {
  return withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    if (shop.status === "CLOSED") throw new ConflictError("This shop is closed.");
    if (input.slug !== shop.slug && (await findShopBySlug(tx, input.slug))) {
      throw new ValidationError("That web address is taken.", { slug: "That web address is taken. Choose another." });
    }
    if (input.slug !== shop.slug) await moveProductsToShopSlug(tx, shop.slug, input.slug);
    await updateShopRow(tx, shop.id, {
      name: input.name,
      slug: input.slug,
      craft: input.craft,
      district: input.district,
      story: input.story,
      quote: input.quote ?? "",
      dispatchDays: input.dispatchDays,
      returnPolicy: input.returnPolicy,
      logo: { id: photoIdFromUrl(input.logo.url)!, alt: input.logo.alt },
      banner: { id: photoIdFromUrl(input.banner.url)!, alt: input.banner.alt },
      updatedAt: new Date().toISOString(),
    });
    await activateIfReady(tx, shop.id);
    return (await findShopById(tx, shop.id))!;
  });
}

/** FR-13: only the last four digits are kept; full bank details belong in the payment provider. */
export async function savePayoutDetails(actor: Actor, input: PayoutInput): Promise<void> {
  await withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    await updateShopRow(tx, shop.id, {
      payoutAccountMasked: `${input.bankName} •••• ${input.accountNumber.slice(-4)}`,
      updatedAt: new Date().toISOString(),
    });
    await activateIfReady(tx, shop.id);
  });
}

/** FR-4: admin actions on a shop. Every action writes an audit row (SEC-A9). */
export async function decideShop(actor: Actor, input: ShopDecisionInput): Promise<Shop> {
  assertRole(actor, ["ADMIN"]);
  return withTx(async (tx) => {
    const shop = await findShopById(tx, input.shopId);
    if (!shop) throw new NotFoundError("Shop not found.");
    const before = { status: shop.status, isVerified: shop.isVerified };
    const reason = "reason" in input ? input.reason : undefined;
    let patch: Partial<Shop> = {};
    switch (input.decision) {
      case "suspend":
        assertTransition(FLOW, shop.status, "SUSPENDED", "shop");
        patch = { status: "SUSPENDED", statusReason: reason };
        await addNotification(tx, shop.ownerId, "shop.suspended", "Your shop has been suspended", "/seller");
        break;
      case "reinstate":
        assertTransition(FLOW, shop.status, "ACTIVE", "shop");
        patch = { status: "ACTIVE", statusReason: undefined };
        await addNotification(tx, shop.ownerId, "shop.reinstated", "Your shop is live again", "/seller");
        break;
      case "verify":
      case "unverify":
        patch = { isVerified: input.decision === "verify" };
        break;
      case "close":
        patch = await closeShop(tx, shop, reason!);
        break;
    }
    const updated = await updateShopRow(
      tx,
      shop.id,
      { ...patch, updatedAt: new Date().toISOString() },
      { from: shop.status },
    );
    if (!updated) throw staleStatus("shop");
    await audit(tx, actor, `shop.${input.decision}`, "SHOP", shop.id, {
      reason,
      before,
      after: { status: updated.status, isVerified: updated.isVerified },
    });
    return updated;
  });
}

/** Permanent close: only without open orders; items archived and the owner becomes a customer again. */
async function closeShop(tx: Tx, shop: Shop, reason: string): Promise<Partial<Shop>> {
  assertTransition(FLOW, shop.status, "CLOSED", "shop");
  const openOrders = (await sellerOrdersOfShop(tx, shop.id)).filter((so) => OPEN_ORDER.includes(so.status));
  if (openOrders.length)
    throw new ConflictError(`Finish or refund ${openOrders.length} open order(s) before closing this shop.`);
  await archiveProductsOfShopSlug(tx, shop.slug);
  await updateUser(tx, shop.ownerId, { role: "CUSTOMER" });
  await addNotification(tx, shop.ownerId, "shop.closed", "Your shop has been closed", "/account");
  return { status: "CLOSED", statusReason: reason };
}
