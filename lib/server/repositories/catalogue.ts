import "server-only";
import type { Product, Shop } from "@/lib/types";
import { readStore, type StoreData } from "../store/dev-store";

// Shops and products. Only this file and its siblings read the store (feature spec 7.4).

export function findShopById(id: string, db: StoreData = readStore()): Shop | undefined {
  return db.shops.find((s) => s.id === id);
}

export function findShopBySlug(slug: string, db: StoreData = readStore()): Shop | undefined {
  return db.shops.find((s) => s.slug === slug);
}

/** RULE-S1: a seller's shop is always found by owner, never by an ID from the browser. */
export function findShopByOwner(ownerId: string, db: StoreData = readStore()): Shop | undefined {
  return db.shops.find((s) => s.ownerId === ownerId && s.status !== "CLOSED");
}

export function listShops(db: StoreData = readStore()): Shop[] {
  return db.shops;
}

export function findProductById(id: string, db: StoreData = readStore()): Product | undefined {
  return db.products.find((p) => p.id === id);
}

export function findProductBySlug(slug: string, db: StoreData = readStore()): Product | undefined {
  return db.products.find((p) => p.slug === slug);
}

export function listProducts(db: StoreData = readStore()): Product[] {
  return db.products;
}

export function productsOfShop(shopId: string, db: StoreData = readStore()): Product[] {
  const shop = findShopById(shopId, db);
  return shop ? db.products.filter((p) => p.shopSlug === shop.slug) : [];
}

export function isShopPublic(shop: Shop | undefined): shop is Shop {
  return shop?.status === "ACTIVE";
}

/** RULE-P4 / RULE-S4: only ACTIVE items of ACTIVE shops are ever public. */
export function isProductPublic(product: Product | undefined, db: StoreData = readStore()): product is Product {
  return product?.status === "ACTIVE" && isShopPublic(findShopBySlug(product.shopSlug, db));
}

export function listPublicProducts(db: StoreData = readStore()): Product[] {
  const activeShops = new Set(db.shops.filter((s) => s.status === "ACTIVE").map((s) => s.slug));
  return db.products.filter((p) => p.status === "ACTIVE" && activeShops.has(p.shopSlug));
}

export function listPublicShops(db: StoreData = readStore()): Shop[] {
  return db.shops.filter((s) => s.status === "ACTIVE");
}

export function findPublicProductBySlug(slug: string, db: StoreData = readStore()): Product | undefined {
  const product = findProductBySlug(slug, db);
  return isProductPublic(product, db) ? product : undefined;
}

export function findPublicShopBySlug(slug: string, db: StoreData = readStore()): Shop | undefined {
  const shop = findShopBySlug(slug, db);
  return isShopPublic(shop) ? shop : undefined;
}
