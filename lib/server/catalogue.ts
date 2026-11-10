import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import {
  type CatalogueProduct,
  type LookupProduct,
  type ProductQuery,
  type RatingSummary,
  type Suggestion,
} from "@/lib/catalogue";
import { categories } from "@/lib/data/categories";
import type { Product, Review, Shop } from "@/lib/types";
import { findPublicShopBySlug, findShopBySlug, listPublicShops } from "./repositories/catalogue";
import {
  itemCountsByShop,
  publicCountsByCategory,
  publicProductPaths,
  queryPublicProducts,
  reviewTotalsByShop,
  searchPublicShops,
  shopReviewTotals,
  similarPublicProducts,
  type CataloguePage,
} from "./repositories/catalogue-search";
import { latestPublicReviewsOfShop, visibleReviewsOfProduct } from "./repositories/content";
import { db } from "./db/tx";
import {
  CATALOGUE_TAG,
  PRODUCTS_TAG,
  SHOPS_TAG,
  categoryTag,
  productTag,
  reviewsTag,
  shopReviewsTag,
  shopTag,
} from "./catalogue-tag";

// Public catalogue reads. Everything here filters to ACTIVE items of ACTIVE shops (RULE-P4, RULE-S4),
// and ratings count only VISIBLE reviews (RULE-R4).
//
// Every read is a small query (B04b), cached per argument. BE-09 (B13): each entry carries CATALOGUE_TAG plus the
// narrow tags of what it shows (lib/server/catalogue-tag.ts), and a change refreshes only those
// (lib/server/actions/refresh.ts). The "hours" lifetime is only a safety net. Admin and seller pages read the
// database directly and never use these caches.

/** cacheTag takes at most 128 tags per call (Next.js docs); a 200-item page needs more than one call. */
const MAX_TAGS_PER_CALL = 128;

function cached(...tags: string[]) {
  cacheLife("hours");
  cacheTag(CATALOGUE_TAG);
  tag(...tags);
}

function tag(...tags: string[]) {
  const unique = [...new Set(tags)];
  for (let i = 0; i < unique.length; i += MAX_TAGS_PER_CALL) cacheTag(...unique.slice(i, i + MAX_TAGS_PER_CALL));
}

/**
 * The tags of one catalogue page: every item it shows (so the page refreshes when one of them changes, or leaves),
 * plus where new items could appear: the category, the shop, or (for anything wider, and for a lookup that found
 * nothing) every list.
 */
export function pageTags(query: ProductQuery, items: { id: string }[]): string[] {
  const tags = items.map((p) => productTag(p.id));
  if (query.slugs) {
    if (items.length < query.slugs.length) tags.push(PRODUCTS_TAG);
    return tags;
  }
  if (query.category) tags.push(categoryTag(query.category));
  if (query.shop) tags.push(shopTag(query.shop));
  if (!query.category && !query.shop) tags.push(PRODUCTS_TAG);
  return tags;
}

/** One page of public items for a catalogue query; `after` is the `next` cursor of the previous page. */
export async function queryCatalogue(
  query: ProductQuery,
  after?: string,
): Promise<CataloguePage & { hasMore: boolean }> {
  "use cache";
  const page = await queryPublicProducts(db, query, after);
  cached(...pageTags(query, page.items));
  return { ...page, hasMore: page.next !== undefined };
}

export async function getPublicProduct(slug: string): Promise<CatalogueProduct | undefined> {
  return (await queryCatalogue({ slugs: [slug], limit: 1 })).items[0];
}

export async function getPublicShop(slug: string): Promise<Shop | undefined> {
  "use cache";
  const shop = await findPublicShopBySlug(db, slug);
  // Tagged with the stored slug, or (nothing found) with the shop list, which a shop going live refreshes.
  cached(shop ? shopTag(shop.slug) : SHOPS_TAG);
  return shop;
}

export async function publicShops(): Promise<Shop[]> {
  "use cache";
  cached(SHOPS_TAG);
  return listPublicShops(db);
}

/** One page of a shop's public items in featured order (B13: the shop page shows a page, then "Load more"). */
export async function publicProductsOfShop(
  shopSlug: string,
  limit: number,
  after?: string,
): Promise<CataloguePage & { hasMore: boolean }> {
  return queryCatalogue({ shop: shopSlug, sort: "featured", limit }, after);
}

/** Item count and rating of every public shop, for /makers: a fixed number of queries, not two per shop (B13). */
export async function publicShopStats(): Promise<Record<string, { count: number; rating?: RatingSummary }>> {
  "use cache";
  const shops = await listPublicShops(db);
  const ids = shops.map((s) => s.id);
  const [counts, totals] = await Promise.all([itemCountsByShop(db, ids, ["ACTIVE"]), reviewTotalsByShop(db, ids)]);
  cached(PRODUCTS_TAG, SHOPS_TAG, ...ids.map(shopReviewsTag));
  return Object.fromEntries(
    shops.map((s) => [
      s.slug,
      { count: counts.get(s.id) ?? 0, rating: toRating(totals.get(s.id) ?? { count: 0, sum: 0 }) },
    ]),
  );
}

/** Up to `count` items from the same category, then from the same shop, never the item itself. */
export async function relatedProducts(p: Product, count = 4): Promise<CatalogueProduct[]> {
  const [sameCategory, sameShop] = await Promise.all([
    queryCatalogue({ category: p.categorySlug, limit: count + 1 }),
    queryCatalogue({ shop: p.shopSlug, limit: count * 2 + 1 }),
  ]);
  const others = sameShop.items.filter((x) => x.categorySlug !== p.categorySlug);
  return [...sameCategory.items, ...others].filter((x) => x.slug !== p.slug).slice(0, count);
}

/** Public items per category: one grouped query, shared by every category tile (B13). */
async function publicCategoryCounts(): Promise<Record<string, number>> {
  "use cache";
  cached(PRODUCTS_TAG);
  return Object.fromEntries(await publicCountsByCategory(db));
}

export async function productCountByCategory(slug: string): Promise<number> {
  return (await publicCategoryCounts())[slug] ?? 0;
}

/** Every public item's address and last change: for the sitemap and the pages built ahead of time. */
export async function publicProductSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  "use cache";
  cached(PRODUCTS_TAG);
  return publicProductPaths(db);
}

/** RULE-R4: an item's visible reviews, newest first, cached with the catalogue. */
export async function publicReviewsOfProduct(productId: string): Promise<Review[]> {
  "use cache";
  cached(reviewsTag(productId));
  return visibleReviewsOfProduct(db, productId);
}

/**
 * The shop page's latest reviews: VISIBLE reviews of its ACTIVE items, newest first, at most `limit`, with the item
 * titles (B13: read in SQL, not all of the shop's reviews filtered here).
 */
export async function latestReviewsOfShop(
  shopId: string,
  limit: number,
): Promise<{ review: Review; productTitle: string }[]> {
  "use cache";
  const rows = await latestPublicReviewsOfShop(db, shopId, limit);
  cached(shopReviewsTag(shopId), ...rows.map((r) => productTag(r.review.productId)));
  return rows;
}

const toRating = ({ count, sum }: { count: number; sum: number }): RatingSummary | undefined =>
  count ? { average: sum / count, count } : undefined;

/** A public shop's rating, cached with the catalogue. */
export async function publicShopRating(shopSlug: string): Promise<RatingSummary | undefined> {
  "use cache";
  const shop = await findPublicShopBySlug(db, shopSlug);
  cached(...(shop ? [shopTag(shop.slug), shopReviewsTag(shop.id)] : [SHOPS_TAG]));
  return shop ? toRating(await shopReviewTotals(db, shop.id)) : undefined;
}

/** Any shop's rating, read fresh: for admin pages, which must always show current data. */
export async function shopRating(shopSlug: string): Promise<RatingSummary | undefined> {
  const shop = await findShopBySlug(db, shopSlug);
  return shop ? toRating(await shopReviewTotals(db, shop.id)) : undefined;
}

/** Ratings of several shops, read fresh for admin pages: one grouped query (B13). Shops without reviews are left out. */
export async function shopRatings(shopIds: string[]): Promise<Map<string, RatingSummary>> {
  const totals = await reviewTotalsByShop(db, shopIds);
  return new Map([...totals].flatMap(([id, t]) => (t.count ? [[id, toRating(t)!] as const] : [])));
}

/**
 * Header search suggestions: categories (English or Sinhala name), makers, then items. When no item matches, close
 * spellings are suggested instead ("batk" → "Batik…", pg_trgm).
 */
export async function searchSuggestions(q: string, limit: number): Promise<Suggestion[]> {
  "use cache";
  cached(PRODUCTS_TAG, SHOPS_TAG);
  const needle = q.normalize("NFC").trim().toLowerCase();
  if (needle.length < 2) return [];
  const fromCategories: Suggestion[] = categories
    .filter((c) => c.name.toLowerCase().includes(needle) || c.sinhala?.includes(needle))
    .map((c) => ({ label: c.name, href: `/c/${c.slug}`, kind: "Category" }));
  const fromShops: Suggestion[] = (await searchPublicShops(db, needle, limit)).map((s) => ({
    label: s.name,
    href: `/shop/${s.slug}`,
    kind: "Maker",
  }));
  let products = (await queryPublicProducts(db, { q: needle, limit })).items.map((p) => ({
    slug: p.slug,
    title: p.title,
  }));
  if (!products.length) products = await similarPublicProducts(db, needle, limit);
  const fromProducts: Suggestion[] = products.map((p) => ({ label: p.title, href: `/p/${p.slug}`, kind: "Product" }));
  return [...fromCategories, ...fromShops, ...fromProducts].slice(0, limit);
}

/** Public summaries for the given slugs, in the order asked; unknown or hidden items are simply left out. */
export async function lookupProducts(slugs: string[]): Promise<LookupProduct[]> {
  if (!slugs.length) return [];
  const [{ items }, shops] = await Promise.all([queryCatalogue({ slugs, limit: slugs.length }), publicShops()]);
  const shopBySlug = new Map(shops.map((s) => [s.slug, s]));
  return slugs
    .map((slug) => items.find((p) => p.slug === slug))
    .filter((p): p is CatalogueProduct => Boolean(p))
    .map((p) => {
      const shop = shopBySlug.get(p.shopSlug)!;
      return {
        slug: p.slug,
        title: p.title,
        image: p.images[0]!,
        type: p.type,
        isCustomizable: p.isCustomizable,
        variants: p.variants,
        customizationLabels: Object.fromEntries(
          (p.customization ?? []).map((f) => [f.key, f.label.replace(" (optional)", "")]),
        ),
        shop: { slug: shop.slug, name: shop.name, dispatchDays: shop.dispatchDays },
      };
    });
}
