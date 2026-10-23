import "server-only";
import type { Product, Shop } from "@/lib/types";
import { out, rowsOf, writableRowsOf, type Tx } from "../db/tx";

// Shops and products. Repositories are the only code that touches stored rows (BE-01).

// ---------- Shops ----------

export async function findShopById(tx: Tx, id: string): Promise<Shop | undefined> {
  return out(
    tx,
    rowsOf(tx).shops.find((s) => s.id === id),
  );
}

export async function findShopBySlug(tx: Tx, slug: string): Promise<Shop | undefined> {
  return out(
    tx,
    rowsOf(tx).shops.find((s) => s.slug === slug),
  );
}

/** RULE-S1: a seller's shop is always found by owner, never by an ID from the browser. */
export async function findShopByOwner(tx: Tx, ownerId: string): Promise<Shop | undefined> {
  return out(
    tx,
    rowsOf(tx).shops.find((s) => s.ownerId === ownerId && s.status !== "CLOSED"),
  );
}

export async function listShops(tx: Tx): Promise<Shop[]> {
  return out(tx, rowsOf(tx).shops);
}

export async function shopSlugs(tx: Tx): Promise<Set<string>> {
  return new Set(rowsOf(tx).shops.map((s) => s.slug));
}

export async function insertShop(tx: Tx, shop: Shop): Promise<Shop> {
  writableRowsOf(tx).shops.push(structuredClone(shop));
  return out(tx, shop);
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updateShop(
  tx: Tx,
  id: string,
  patch: Partial<Shop>,
  guard: { from?: Shop["status"] } = {},
): Promise<Shop | undefined> {
  const shop = writableRowsOf(tx).shops.find((s) => s.id === id);
  if (!shop || (guard.from && shop.status !== guard.from)) return undefined;
  Object.assign(shop, patch);
  return out(tx, shop);
}

// ---------- Products ----------

export async function findProductById(tx: Tx, id: string): Promise<Product | undefined> {
  return out(
    tx,
    rowsOf(tx).products.find((p) => p.id === id),
  );
}

export async function findProductBySlug(tx: Tx, slug: string): Promise<Product | undefined> {
  return out(
    tx,
    rowsOf(tx).products.find((p) => p.slug === slug),
  );
}

export async function listProducts(tx: Tx): Promise<Product[]> {
  return out(tx, rowsOf(tx).products);
}

export async function productsOfShopSlug(tx: Tx, shopSlug: string): Promise<Product[]> {
  return out(
    tx,
    rowsOf(tx).products.filter((p) => p.shopSlug === shopSlug),
  );
}

export async function productsOfShop(tx: Tx, shopId: string): Promise<Product[]> {
  const shop = rowsOf(tx).shops.find((s) => s.id === shopId);
  return shop ? productsOfShopSlug(tx, shop.slug) : [];
}

/** Slugs in use by every product except `exceptId` (so an item keeps its own slug when edited). */
export async function productSlugs(tx: Tx, exceptId?: string): Promise<Set<string>> {
  return new Set(
    rowsOf(tx)
      .products.filter((p) => p.id !== exceptId)
      .map((p) => p.slug),
  );
}

export async function insertProduct(tx: Tx, product: Product): Promise<Product> {
  writableRowsOf(tx).products.push(structuredClone(product));
  return out(tx, product);
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updateProduct(
  tx: Tx,
  id: string,
  patch: Partial<Product>,
  guard: { from?: Product["status"] } = {},
): Promise<Product | undefined> {
  const product = writableRowsOf(tx).products.find((p) => p.id === id);
  if (!product || (guard.from && product.status !== guard.from)) return undefined;
  Object.assign(product, structuredClone(patch));
  return out(tx, product);
}

/** A shop changed its web address: its items follow it. */
export async function moveProductsToShopSlug(tx: Tx, from: string, to: string): Promise<void> {
  writableRowsOf(tx)
    .products.filter((p) => p.shopSlug === from)
    .forEach((p) => (p.shopSlug = to));
}

/** A closed shop's items are archived, except ones CeyLiving already removed. */
export async function archiveProductsOfShopSlug(tx: Tx, shopSlug: string): Promise<void> {
  writableRowsOf(tx)
    .products.filter((p) => p.shopSlug === shopSlug && p.status !== "REMOVED")
    .forEach((p) => (p.status = "ARCHIVED"));
}

// ---------- Public visibility (RULE-P4 / RULE-S4) ----------

export function isShopPublic(shop: Shop | undefined): shop is Shop {
  return shop?.status === "ACTIVE";
}

/** RULE-P4 / RULE-S4: only ACTIVE items of ACTIVE shops are ever public. */
export async function isProductPublic(tx: Tx, product: Product | undefined): Promise<boolean> {
  return product?.status === "ACTIVE" && isShopPublic(await findShopBySlug(tx, product.shopSlug));
}

export async function listPublicProducts(tx: Tx): Promise<Product[]> {
  const rows = rowsOf(tx);
  const activeShops = new Set(rows.shops.filter((s) => s.status === "ACTIVE").map((s) => s.slug));
  return out(
    tx,
    rows.products.filter((p) => p.status === "ACTIVE" && activeShops.has(p.shopSlug)),
  );
}

export async function listPublicShops(tx: Tx): Promise<Shop[]> {
  return out(
    tx,
    rowsOf(tx).shops.filter((s) => s.status === "ACTIVE"),
  );
}

export async function findPublicProductBySlug(tx: Tx, slug: string): Promise<Product | undefined> {
  const product = await findProductBySlug(tx, slug);
  return (await isProductPublic(tx, product)) ? product : undefined;
}

export async function findPublicShopBySlug(tx: Tx, slug: string): Promise<Shop | undefined> {
  const shop = await findShopBySlug(tx, slug);
  return isShopPublic(shop) ? shop : undefined;
}
