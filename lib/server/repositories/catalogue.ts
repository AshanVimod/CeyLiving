import "server-only";
import { PRODUCT_LIMITS } from "@/lib/config";
import type { Product, Shop } from "@/lib/types";
import type { Prisma } from "../db/generated/client";
import {
  clearing,
  customizationRows,
  imageRows,
  productColumns,
  productInclude,
  shopColumns,
  toProduct,
  toShop,
  variantRows,
} from "../db/mappers";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// Shops and products. Repositories are the only code that touches stored rows (BE-01). Products link to their
// shop by shop_id; `shopSlug` is read through that link.

export function isShopPublic(shop: Shop | undefined): shop is Shop {
  return shop?.status === "ACTIVE";
}

const oldestFirst = [{ createdAt: "asc" }, { id: "asc" }] as const;

// ---------- Shops ----------

export async function findShopById(tx: Tx, id: string): Promise<Shop | undefined> {
  const row = await clientOf(tx).shop.findUnique({ where: { id } });
  return row ? toShop(row) : undefined;
}

export async function findShopBySlug(tx: Tx, slug: string): Promise<Shop | undefined> {
  const row = await clientOf(tx).shop.findUnique({ where: { slug } });
  return row ? toShop(row) : undefined;
}

/** RULE-S1: a seller's shop is always found by owner, never by an ID from the browser. */
export async function findShopByOwner(tx: Tx, ownerId: string): Promise<Shop | undefined> {
  const row = await clientOf(tx).shop.findFirst({ where: { ownerId, status: { not: "CLOSED" } } });
  return row ? toShop(row) : undefined;
}

export async function listShops(tx: Tx): Promise<Shop[]> {
  const rows = await clientOf(tx).shop.findMany({ orderBy: [...oldestFirst] });
  return rows.map(toShop);
}

export async function shopSlugs(tx: Tx): Promise<Set<string>> {
  const rows = await clientOf(tx).shop.findMany({ select: { slug: true } });
  return new Set(rows.map((row) => row.slug));
}

export async function insertShop(tx: Tx, shop: Shop): Promise<Shop> {
  const data = shopColumns(shop) as Prisma.ShopUncheckedCreateInput;
  return toShop(await writableClientOf(tx).shop.create({ data }));
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updateShop(
  tx: Tx,
  id: string,
  patch: Partial<Shop>,
  guard: { from?: Shop["status"] } = {},
): Promise<Shop | undefined> {
  const data = clearing(shopColumns(patch)) as Prisma.ShopUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).shop.updateMany({
    where: { id, ...(guard.from && { status: guard.from }) },
    data,
  });
  return count === 0 ? undefined : findShopById(tx, id);
}

// ---------- Products ----------

export async function findProductById(tx: Tx, id: string): Promise<Product | undefined> {
  const row = await clientOf(tx).product.findUnique({ where: { id }, include: productInclude });
  return row ? toProduct(row) : undefined;
}

export async function findProductBySlug(tx: Tx, slug: string): Promise<Product | undefined> {
  const row = await clientOf(tx).product.findUnique({ where: { slug }, include: productInclude });
  return row ? toProduct(row) : undefined;
}

export async function listProducts(tx: Tx): Promise<Product[]> {
  const rows = await clientOf(tx).product.findMany({ include: productInclude, orderBy: [...oldestFirst] });
  return rows.map(toProduct);
}

export async function productsOfShopSlug(tx: Tx, shopSlug: string): Promise<Product[]> {
  const rows = await clientOf(tx).product.findMany({
    where: { shop: { slug: shopSlug } },
    include: productInclude,
    orderBy: [...oldestFirst],
  });
  return rows.map(toProduct);
}

export async function productsOfShop(tx: Tx, shopId: string): Promise<Product[]> {
  const rows = await clientOf(tx).product.findMany({
    where: { shopId },
    include: productInclude,
    orderBy: [...oldestFirst],
  });
  return rows.map(toProduct);
}

/** Slugs in use by every product except `exceptId` (so an item keeps its own slug when edited). */
export async function productSlugs(tx: Tx, exceptId?: string): Promise<Set<string>> {
  const rows = await clientOf(tx).product.findMany({
    where: exceptId ? { id: { not: exceptId } } : {},
    select: { slug: true },
  });
  return new Set(rows.map((row) => row.slug));
}

/** The shop id behind a slug; a slug that no shop has is a bug in the caller, so it throws. */
async function shopIdOf(tx: Tx, slug: string): Promise<string> {
  const shop = await clientOf(tx).shop.findUnique({ where: { slug }, select: { id: true } });
  if (!shop) throw new Error(`Shop ${slug} missing`);
  return shop.id;
}

/** DB-04: the product and its images, variants and customization fields are written together. */
export async function insertProduct(tx: Tx, product: Product): Promise<Product> {
  const client = writableClientOf(tx);
  const shopId = await shopIdOf(tx, product.shopSlug);
  await client.product.create({ data: { ...productColumns(product), shopId } as Prisma.ProductUncheckedCreateInput });
  await client.productImage.createMany({ data: imageRows(product.id, product.images) });
  await client.productVariant.createMany({ data: variantRows(product.id, product.variants) });
  await client.customizationField.createMany({ data: customizationRows(product.id, product.customization ?? []) });
  return (await findProductById(tx, product.id))!;
}

/**
 * DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise.
 * DB-04: a patch with images, variants or customization replaces that whole list in the same transaction, so a
 * failure (for example a price the CHECK constraints refuse) leaves the product exactly as it was.
 */
export async function updateProduct(
  tx: Tx,
  id: string,
  patch: Partial<Product>,
  guard: { from?: Product["status"] } = {},
): Promise<Product | undefined> {
  const client = writableClientOf(tx);
  const columns = clearing(productColumns(patch)) as Record<string, unknown>;
  if (patch.shopSlug) columns.shopId = await shopIdOf(tx, patch.shopSlug);
  const { count } = await client.product.updateMany({
    where: { id, ...(guard.from && { status: guard.from }) },
    data: columns as Prisma.ProductUncheckedUpdateManyInput,
  });
  if (count === 0) return undefined;

  if (patch.images) {
    await client.productImage.deleteMany({ where: { productId: id } });
    await client.productImage.createMany({ data: imageRows(id, patch.images) });
  }
  if (patch.variants) {
    await client.productVariant.deleteMany({ where: { productId: id } });
    await client.productVariant.createMany({ data: variantRows(id, patch.variants) });
  }
  if ("customization" in patch) {
    await client.customizationField.deleteMany({ where: { productId: id } });
    await client.customizationField.createMany({ data: customizationRows(id, patch.customization ?? []) });
  }
  return findProductById(tx, id);
}

/**
 * A shop changed its web address: its items follow it. Products link to the shop by id here, so they already
 * follow; this only checks the call is made inside a transaction.
 */
export async function moveProductsToShopSlug(tx: Tx, from: string, to: string): Promise<void> {
  void from;
  void to;
  writableClientOf(tx);
}

/** A closed shop's items are archived, except ones CeyLiving already removed. */
export async function archiveProductsOfShopSlug(tx: Tx, shopSlug: string): Promise<void> {
  await writableClientOf(tx).product.updateMany({
    where: { shop: { slug: shopSlug }, status: { not: "REMOVED" } },
    data: { status: "ARCHIVED" },
  });
}

// ---------- Public visibility (RULE-P4 / RULE-S4) ----------

/** RULE-P4 / RULE-S4: only ACTIVE items of ACTIVE shops are ever public. */
export async function isProductPublic(tx: Tx, product: Product | undefined): Promise<boolean> {
  return product?.status === "ACTIVE" && isShopPublic(await findShopBySlug(tx, product.shopSlug));
}

export async function listPublicShops(tx: Tx): Promise<Shop[]> {
  const rows = await clientOf(tx).shop.findMany({ where: { status: "ACTIVE" }, orderBy: [...oldestFirst] });
  return rows.map(toShop);
}

export async function findPublicProductBySlug(tx: Tx, slug: string): Promise<Product | undefined> {
  const product = await findProductBySlug(tx, slug);
  return (await isProductPublic(tx, product)) ? product : undefined;
}

export async function findPublicShopBySlug(tx: Tx, slug: string): Promise<Shop | undefined> {
  const shop = await findShopBySlug(tx, slug);
  return isShopPublic(shop) ? shop : undefined;
}

// ---------- Checkout stock (B07, BR-06) ----------

/** RULE-P4 / RULE-S4: the public items among `slugs`, each with its shop, in one query (BR-04: current prices). */
export async function publicProductsForCheckout(tx: Tx, slugs: string[]): Promise<{ product: Product; shop: Shop }[]> {
  const rows = await clientOf(tx).product.findMany({
    where: { slug: { in: slugs }, status: "ACTIVE", shop: { status: "ACTIVE" } },
    include: { ...productInclude, shop: true },
  });
  return rows.map((row) => ({ product: toProduct(row), shop: toShop(row.shop) }));
}

/**
 * BR-06 / DB-06: takes `quantity` from a variant's stock only while that much is left, in one statement. Two
 * checkouts racing for the last one: the second waits for the first's row lock, then finds too little and gets false.
 */
export async function reserveStock(tx: Tx, productId: string, sku: string, quantity: number): Promise<boolean> {
  const { count } = await writableClientOf(tx).productVariant.updateMany({
    where: { productId, sku, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  });
  return count === 1;
}

/** A variant's stock right now, or undefined when the variant is gone. */
export async function stockOf(tx: Tx, productId: string, sku: string): Promise<number | undefined> {
  const row = await clientOf(tx).productVariant.findUnique({
    where: { productId_sku: { productId, sku } },
    select: { stock: true },
  });
  return row?.stock;
}

/**
 * BR-06: gives back stock an unpaid order took. Capped at the stock limit, so a seller who raised the stock to the
 * maximum meanwhile can't make the release fail; a variant deleted meanwhile is simply skipped.
 */
export async function releaseStock(tx: Tx, productId: string, sku: string, quantity: number): Promise<void> {
  await writableClientOf(tx).$executeRaw`
    UPDATE product_variants SET stock = LEAST(stock + ${quantity}, ${PRODUCT_LIMITS.stockMax})
    WHERE product_id = ${productId} AND sku = ${sku}`;
}
