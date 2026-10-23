import "server-only";
import { APPROVED_ITEMS_FOR_AUTOPUBLISH } from "@/lib/config";
import type { Product, ProductStatus, Shop } from "@/lib/types";
import type { ProductDecisionInput, ProductInput } from "@/lib/validation/product";
import { photoIdFromUrl } from "@/lib/validation/photo";
import { ConflictError, NotFoundError } from "../errors";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { transaction, type StoreData } from "../store/dev-store";
import { activateIfReady } from "./shops";
import { assertTransition, audit, slugify, uniqueSlug } from "./shared";

// Feature spec 8.3: product status flow. Sellers move their own items; admins approve, reject and remove.
const SELLER_FLOW: Partial<Record<ProductStatus, readonly ProductStatus[]>> = {
  DRAFT: ["DRAFT", "PENDING_REVIEW", "ACTIVE", "ARCHIVED"],
  PENDING_REVIEW: ["DRAFT", "PENDING_REVIEW", "ARCHIVED"],
  REJECTED: ["DRAFT", "PENDING_REVIEW", "ARCHIVED"],
  ACTIVE: ["ACTIVE", "PENDING_REVIEW", "DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

const ADMIN_FLOW: Partial<Record<ProductStatus, readonly ProductStatus[]>> = {
  PENDING_REVIEW: ["ACTIVE", "REJECTED", "REMOVED"],
  DRAFT: ["REMOVED"],
  ACTIVE: ["REMOVED"],
  REJECTED: ["REMOVED"],
  ARCHIVED: ["REMOVED"],
};

/** RULE-P2: count of the shop's items an admin has approved (still on sale). */
export function approvedCount(shop: Shop, db: StoreData): number {
  return db.products.filter((p) => p.shopSlug === shop.slug && p.status === "ACTIVE").length;
}

function ownProduct(shop: Shop, productId: string, db: StoreData): Product {
  const product = db.products.find((p) => p.id === productId && p.shopSlug === shop.slug);
  if (!product) throw new NotFoundError("Item not found."); // SEC-A5: other shops' items look missing
  return product;
}

function toFields(
  input: ProductInput,
  shop: Shop,
  slug: string,
): Omit<Product, "id" | "status" | "createdAt" | "updatedAt" | "publishedAt"> {
  const skuBase = slug.slice(0, 12).toUpperCase();
  return {
    slug,
    title: input.title,
    shopSlug: shop.slug,
    categorySlug: input.categorySlug,
    subcategory: input.subcategory,
    description: input.description,
    materials: input.materials,
    materialNote: input.materialNote,
    styles: input.styles,
    tags: input.tags,
    type: input.type,
    processingDays: input.type === "MADE_TO_ORDER" ? input.processingDays : undefined,
    isCustomizable: input.customization.length > 0,
    isHeritage: input.isHeritage,
    isEcoFriendly: input.isEcoFriendly,
    dimensions: input.dimensions,
    care: input.care,
    images: input.images.map((i) => ({ id: photoIdFromUrl(i.url)!, alt: i.alt })),
    variants: input.variants.map((v, i) => ({
      sku: `${skuBase}-${i + 1}`,
      label: v.label,
      priceCents: v.price,
      compareAtPriceCents: v.compareAt,
      stock: v.stock,
    })),
    customization: input.customization.map((f, i) => ({
      key: `field${i + 1}`,
      label: f.label,
      kind: f.kind,
      options: f.kind === "SELECT" ? f.options : undefined,
      maxLength: f.maxLength,
      isRequired: f.isRequired,
      helper: f.helper,
    })),
  };
}

/**
 * FR-2c: create or edit an item. Drafts save as they are; submitting goes to review for new shops
 * and straight to ACTIVE once the shop has enough approved items (RULE-P2).
 */
export async function saveProduct(
  actor: Actor,
  input: ProductInput,
  intent: "draft" | "submit",
  productId?: string,
): Promise<Product> {
  return transaction((db) => {
    const shop = shopOfSeller(actor, db);
    if (shop.status === "CLOSED") throw new ConflictError("This shop is closed.");
    const existing = productId ? ownProduct(shop, productId, db) : undefined;
    if (existing?.status === "REMOVED")
      throw new ConflictError("This item was removed by CeyLiving and can’t be edited.");
    const now = new Date().toISOString();
    const taken = new Set(db.products.filter((p) => p.id !== existing?.id).map((p) => p.slug));
    const slug = existing && existing.status !== "DRAFT" ? existing.slug : uniqueSlug(slugify(input.title), taken);
    const next: ProductStatus =
      intent === "draft"
        ? "DRAFT"
        : approvedCount(shop, db) - (existing?.status === "ACTIVE" ? 1 : 0) >= APPROVED_ITEMS_FOR_AUTOPUBLISH
          ? "ACTIVE"
          : "PENDING_REVIEW";
    if (existing) assertTransition(SELLER_FLOW, existing.status, next, "item");
    const fields = toFields(input, shop, slug);
    const product: Product = existing
      ? Object.assign(existing, fields, {
          status: next,
          rejectionReason: undefined,
          updatedAt: now,
          publishedAt: next === "ACTIVE" && existing.status !== "ACTIVE" ? now.slice(0, 10) : existing.publishedAt,
        })
      : { ...fields, id: newId("prod"), status: next, createdAt: now, updatedAt: now, publishedAt: now.slice(0, 10) };
    if (!existing) db.products.push(product);
    if (next === "PENDING_REVIEW") {
      db.users
        .filter((u) => u.role === "ADMIN")
        .forEach((a) =>
          addNotification(db, a.id, "product.pending", `New item to review: ${product.title}`, "/admin/products"),
        );
    }
    activateIfReady(shop, db);
    return product;
  });
}

export async function archiveProduct(actor: Actor, productId: string): Promise<void> {
  await transaction((db) => {
    const product = ownProduct(shopOfSeller(actor, db), productId, db);
    assertTransition(SELLER_FLOW, product.status, "ARCHIVED", "item");
    product.status = "ARCHIVED";
    product.updatedAt = new Date().toISOString();
  });
}

export async function restoreProduct(actor: Actor, productId: string): Promise<void> {
  await transaction((db) => {
    const product = ownProduct(shopOfSeller(actor, db), productId, db);
    assertTransition(SELLER_FLOW, product.status, "DRAFT", "item");
    product.status = "DRAFT";
    product.updatedAt = new Date().toISOString();
  });
}

/** FR-9: admins approve or reject items waiting for review, or remove rule-breaking items (with a reason). */
export async function decideProduct(actor: Actor, input: ProductDecisionInput): Promise<Product> {
  assertRole(actor, ["ADMIN"]);
  return transaction((db) => {
    const product = db.products.find((p) => p.id === input.productId);
    if (!product) throw new NotFoundError("Item not found.");
    const to: ProductStatus =
      input.decision === "approve" ? "ACTIVE" : input.decision === "reject" ? "REJECTED" : "REMOVED";
    assertTransition(ADMIN_FLOW, product.status, to, "item");
    const before = product.status;
    const reason = input.decision === "approve" ? undefined : input.reason;
    Object.assign(product, { status: to, rejectionReason: reason, updatedAt: new Date().toISOString() });
    if (to === "ACTIVE") product.publishedAt = new Date().toISOString().slice(0, 10);
    const shop = db.shops.find((s) => s.slug === product.shopSlug);
    if (shop) {
      const title =
        to === "ACTIVE"
          ? `“${product.title}” is approved and on sale`
          : to === "REJECTED"
            ? `“${product.title}” needs changes`
            : `“${product.title}” was removed`;
      addNotification(db, shop.ownerId, `product.${to.toLowerCase()}`, title, `/seller/products/${product.id}/edit`);
      activateIfReady(shop, db);
    }
    audit(db, actor, `product.${input.decision}`, "PRODUCT", product.id, { reason, before, after: to });
    return product;
  });
}
