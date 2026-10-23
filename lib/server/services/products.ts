import "server-only";
import { APPROVED_ITEMS_FOR_AUTOPUBLISH } from "@/lib/config";
import type { Product, ProductStatus, Shop } from "@/lib/types";
import type { ProductDecisionInput, ProductInput } from "@/lib/validation/product";
import { photoIdFromUrl } from "@/lib/validation/photo";
import { ConflictError, NotFoundError } from "../errors";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import { withTx, type Tx } from "../db/tx";
import {
  findProductById,
  findShopBySlug,
  insertProduct,
  productSlugs,
  productsOfShopSlug,
  updateProduct,
} from "../repositories/catalogue";
import { addNotification, listAdminIds, newId } from "../repositories/people";
import { activateIfReady } from "./shops";
import { assertTransition, audit, slugify, staleStatus, uniqueSlug } from "./shared";

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
export async function approvedCount(shop: Shop, tx: Tx): Promise<number> {
  return (await productsOfShopSlug(tx, shop.slug)).filter((p) => p.status === "ACTIVE").length;
}

async function ownProduct(shop: Shop, productId: string, tx: Tx): Promise<Product> {
  const product = await findProductById(tx, productId);
  if (!product || product.shopSlug !== shop.slug) throw new NotFoundError("Item not found."); // SEC-A5: other shops' items look missing
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
  return withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    if (shop.status === "CLOSED") throw new ConflictError("This shop is closed.");
    const existing = productId ? await ownProduct(shop, productId, tx) : undefined;
    if (existing?.status === "REMOVED")
      throw new ConflictError("This item was removed by CeyLiving and can’t be edited.");
    const now = new Date().toISOString();
    const slug =
      existing && existing.status !== "DRAFT"
        ? existing.slug
        : uniqueSlug(slugify(input.title), await productSlugs(tx, existing?.id));
    const next: ProductStatus =
      intent === "draft"
        ? "DRAFT"
        : (await approvedCount(shop, tx)) - (existing?.status === "ACTIVE" ? 1 : 0) >= APPROVED_ITEMS_FOR_AUTOPUBLISH
          ? "ACTIVE"
          : "PENDING_REVIEW";
    if (existing) assertTransition(SELLER_FLOW, existing.status, next, "item");
    const fields = toFields(input, shop, slug);
    let product: Product;
    if (existing) {
      const updated = await updateProduct(
        tx,
        existing.id,
        {
          ...fields,
          status: next,
          rejectionReason: undefined,
          updatedAt: now,
          publishedAt: next === "ACTIVE" && existing.status !== "ACTIVE" ? now.slice(0, 10) : existing.publishedAt,
        },
        { from: existing.status },
      );
      if (!updated) throw staleStatus("item");
      product = updated;
    } else {
      product = await insertProduct(tx, {
        ...fields,
        id: newId("prod"),
        status: next,
        createdAt: now,
        updatedAt: now,
        publishedAt: now.slice(0, 10),
      });
    }
    if (next === "PENDING_REVIEW") {
      for (const adminId of await listAdminIds(tx))
        await addNotification(
          tx,
          adminId,
          "product.pending",
          `New item to review: ${product.title}`,
          "/admin/products",
        );
    }
    await activateIfReady(tx, shop.id);
    return product;
  });
}

async function moveOwnProduct(actor: Actor, productId: string, to: ProductStatus): Promise<void> {
  await withTx(async (tx) => {
    const product = await ownProduct(await shopOfSeller(actor, tx), productId, tx);
    assertTransition(SELLER_FLOW, product.status, to, "item");
    const updated = await updateProduct(
      tx,
      product.id,
      { status: to, updatedAt: new Date().toISOString() },
      { from: product.status },
    );
    if (!updated) throw staleStatus("item");
  });
}

export async function archiveProduct(actor: Actor, productId: string): Promise<void> {
  await moveOwnProduct(actor, productId, "ARCHIVED");
}

export async function restoreProduct(actor: Actor, productId: string): Promise<void> {
  await moveOwnProduct(actor, productId, "DRAFT");
}

/** FR-9: admins approve or reject items waiting for review, or remove rule-breaking items (with a reason). */
export async function decideProduct(actor: Actor, input: ProductDecisionInput): Promise<Product> {
  assertRole(actor, ["ADMIN"]);
  return withTx(async (tx) => {
    const product = await findProductById(tx, input.productId);
    if (!product) throw new NotFoundError("Item not found.");
    const to: ProductStatus =
      input.decision === "approve" ? "ACTIVE" : input.decision === "reject" ? "REJECTED" : "REMOVED";
    assertTransition(ADMIN_FLOW, product.status, to, "item");
    const before = product.status;
    const reason = input.decision === "approve" ? undefined : input.reason;
    const now = new Date().toISOString();
    const updated = await updateProduct(
      tx,
      product.id,
      {
        status: to,
        rejectionReason: reason,
        updatedAt: now,
        ...(to === "ACTIVE" ? { publishedAt: now.slice(0, 10) } : {}),
      },
      { from: before },
    );
    if (!updated) throw staleStatus("item");
    const shop = await findShopBySlug(tx, updated.shopSlug);
    if (shop) {
      const title =
        to === "ACTIVE"
          ? `“${updated.title}” is approved and on sale`
          : to === "REJECTED"
            ? `“${updated.title}” needs changes`
            : `“${updated.title}” was removed`;
      await addNotification(
        tx,
        shop.ownerId,
        `product.${to.toLowerCase()}`,
        title,
        `/seller/products/${updated.id}/edit`,
      );
      await activateIfReady(tx, shop.id);
    }
    await audit(tx, actor, `product.${input.decision}`, "PRODUCT", updated.id, { reason, before, after: to });
    return updated;
  });
}
