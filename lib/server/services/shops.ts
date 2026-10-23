import "server-only";
import { TEXT_LIMITS } from "@/lib/config";
import type { Shop, ShopStatus } from "@/lib/types";
import { photoIdFromUrl } from "@/lib/validation/photo";
import type { PayoutInput, ShopDecisionInput, ShopInput } from "@/lib/validation/shop";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import { addNotification, updateUser } from "../repositories/people";
import { transaction, type StoreData } from "../store/dev-store";
import { assertTransition, audit } from "./shared";

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
export function shopChecklist(shop: Shop, db: StoreData): Checklist {
  return {
    profileComplete:
      hasPhoto(shop.logo) &&
      hasPhoto(shop.banner) &&
      shop.story.length >= TEXT_LIMITS.storyMin &&
      Boolean(shop.district && shop.dispatchDays && shop.returnPolicy),
    firstItem: db.products.some(
      (p) => p.shopSlug === shop.slug && (p.status === "ACTIVE" || p.status === "PENDING_REVIEW"),
    ),
    payoutAdded: Boolean(shop.payoutAccountMasked),
  };
}

/** Moves a DRAFT shop to ACTIVE once every checklist item is done (RULE-S3). */
export function activateIfReady(shop: Shop, db: StoreData): void {
  if (shop.status !== "DRAFT") return;
  const c = shopChecklist(shop, db);
  if (c.profileComplete && c.firstItem && c.payoutAdded) {
    shop.status = "ACTIVE";
    shop.updatedAt = new Date().toISOString();
    addNotification(db, shop.ownerId, "shop.active", "Your shop is now live on CeyLiving", `/shop/${shop.slug}`);
  }
}

/** FR-2b: the seller edits their own shop, always loaded by owner (RULE-S1). */
export async function updateShop(actor: Actor, input: ShopInput): Promise<Shop> {
  return transaction((db) => {
    const shop = shopOfSeller(actor, db);
    if (shop.status === "CLOSED") throw new ConflictError("This shop is closed.");
    if (input.slug !== shop.slug && db.shops.some((s) => s.slug === input.slug)) {
      throw new ValidationError("That web address is taken.", { slug: "That web address is taken. Choose another." });
    }
    if (input.slug !== shop.slug) {
      db.products.filter((p) => p.shopSlug === shop.slug).forEach((p) => (p.shopSlug = input.slug));
    }
    Object.assign(shop, {
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
    activateIfReady(shop, db);
    return shop;
  });
}

/** FR-13: only the last four digits are kept; full bank details belong in the payment provider. */
export async function savePayoutDetails(actor: Actor, input: PayoutInput): Promise<void> {
  await transaction((db) => {
    const shop = shopOfSeller(actor, db);
    shop.payoutAccountMasked = `${input.bankName} •••• ${input.accountNumber.slice(-4)}`;
    shop.updatedAt = new Date().toISOString();
    activateIfReady(shop, db);
  });
}

/** FR-4: admin actions on a shop. Every action writes an audit row (SEC-A9). */
export async function decideShop(actor: Actor, input: ShopDecisionInput): Promise<Shop> {
  assertRole(actor, ["ADMIN"]);
  return transaction((db) => {
    const shop = db.shops.find((s) => s.id === input.shopId);
    if (!shop) throw new NotFoundError("Shop not found.");
    const before = { status: shop.status, isVerified: shop.isVerified };
    const reason = "reason" in input ? input.reason : undefined;
    switch (input.decision) {
      case "suspend":
        assertTransition(FLOW, shop.status, "SUSPENDED", "shop");
        Object.assign(shop, { status: "SUSPENDED", statusReason: reason });
        addNotification(db, shop.ownerId, "shop.suspended", "Your shop has been suspended", "/seller");
        break;
      case "reinstate":
        assertTransition(FLOW, shop.status, "ACTIVE", "shop");
        Object.assign(shop, { status: "ACTIVE", statusReason: undefined });
        addNotification(db, shop.ownerId, "shop.reinstated", "Your shop is live again", "/seller");
        break;
      case "verify":
      case "unverify":
        shop.isVerified = input.decision === "verify";
        break;
      case "close":
        closeShop(db, shop, reason!);
        break;
    }
    shop.updatedAt = new Date().toISOString();
    audit(db, actor, `shop.${input.decision}`, "SHOP", shop.id, {
      reason,
      before,
      after: { status: shop.status, isVerified: shop.isVerified },
    });
    return shop;
  });
}

/** Permanent close: only without open orders; items archived and the owner becomes a customer again. */
function closeShop(db: StoreData, shop: Shop, reason: string) {
  assertTransition(FLOW, shop.status, "CLOSED", "shop");
  const openOrders = db.sellerOrders.filter((so) => so.shopId === shop.id && OPEN_ORDER.includes(so.status));
  if (openOrders.length)
    throw new ConflictError(`Finish or refund ${openOrders.length} open order(s) before closing this shop.`);
  Object.assign(shop, { status: "CLOSED", statusReason: reason });
  db.products.filter((p) => p.shopSlug === shop.slug && p.status !== "REMOVED").forEach((p) => (p.status = "ARCHIVED"));
  updateUser(db, shop.ownerId, { role: "CUSTOMER" });
  addNotification(db, shop.ownerId, "shop.closed", "Your shop has been closed", "/account");
}
