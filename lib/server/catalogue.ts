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
  publicProductPaths,
  queryPublicProducts,
  searchPublicShops,
  shopReviewTotals,
  similarPublicProducts,
  type CataloguePage,
} from "./repositories/catalogue-search";
import { reviewsOfShop, visibleReviewsOfProduct } from "./repositories/content";
import { db } from "./db/tx";
import { CATALOGUE_TAG } from "./catalogue-tag";

// Public catalogue reads. Everything here filters to ACTIVE items of ACTIVE shops (RULE-P4, RULE-S4),
// and ratings count only VISIBLE reviews (RULE-R4).
//
// Every read is a small query (B04b), cached per argument and tagged CATALOGUE_TAG. Any action that changes an
// item, a shop, a review or a question calls refreshEverything() (lib/server/actions/refresh.ts), which expires the
// tag, so the next visit reads fresh rows. The "hours" lifetime is only a safety net. Admin and seller pages read
// the database directly and never use these caches.

function cached() {
  cacheLife("hours");
  cacheTag(CATALOGUE_TAG);
}

/** One page of public items for a catalogue query; `after` is the `next` cursor of the previous page. */
export async function queryCatalogue(
  query: ProductQuery,
  after?: string,
): Promise<CataloguePage & { hasMore: boolean }> {
  "use cache";
  cached();
  const page = await queryPublicProducts(db, query, after);
  return { ...page, hasMore: page.next !== undefined };
}

export async function getPublicProduct(slug: string): Promise<CatalogueProduct | undefined> {
  return (await queryCatalogue({ slugs: [slug], limit: 1 })).items[0];
}

export async function getPublicShop(slug: string): Promise<Shop | undefined> {
  "use cache";
  cached();
  return findPublicShopBySlug(db, slug);
}

export async function publicShops(): Promise<Shop[]> {
  "use cache";
  cached();
  return listPublicShops(db);
}

/** A shop's public items in featured order (a shop shows at most a page of 200). */
export async function publicProductsOfShop(shopSlug: string): Promise<CatalogueProduct[]> {
  return (await queryCatalogue({ shop: shopSlug, sort: "featured" })).items;
}

export async function publicProductCountOfShop(shopSlug: string): Promise<number> {
  return (await queryCatalogue({ shop: shopSlug, limit: 1 })).total;
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

export async function productCountByCategory(slug: string): Promise<number> {
  return (await queryCatalogue({ category: slug, limit: 1 })).total;
}

/** Every public item's address and last change: for the sitemap and the pages built ahead of time. */
export async function publicProductSlugs(): Promise<{ slug: string; updatedAt: string }[]> {
  "use cache";
  cached();
  return publicProductPaths(db);
}

/** RULE-R4: an item's visible reviews, newest first, cached with the catalogue. */
export async function publicReviewsOfProduct(productId: string): Promise<Review[]> {
  "use cache";
  cached();
  return visibleReviewsOfProduct(db, productId);
}

/** A shop's reviews, newest first, cached with the catalogue; the shop page shows only the visible ones. */
export async function publicReviewsOfShop(shopId: string): Promise<Review[]> {
  "use cache";
  cached();
  return reviewsOfShop(db, shopId);
}

const toRating = ({ count, sum }: { count: number; sum: number }): RatingSummary | undefined =>
  count ? { average: sum / count, count } : undefined;

/** A public shop's rating, cached with the catalogue. */
export async function publicShopRating(shopSlug: string): Promise<RatingSummary | undefined> {
  "use cache";
  cached();
  const shop = await findPublicShopBySlug(db, shopSlug);
  return shop ? toRating(await shopReviewTotals(db, shop.id)) : undefined;
}

/** Any shop's rating, read fresh: for admin pages, which must always show current data. */
export async function shopRating(shopSlug: string): Promise<RatingSummary | undefined> {
  const shop = await findShopBySlug(db, shopSlug);
  return shop ? toRating(await shopReviewTotals(db, shop.id)) : undefined;
}

/**
 * Header search suggestions: categories (English or Sinhala name), makers, then items. When no item matches, close
 * spellings are suggested instead ("batk" → "Batik…", pg_trgm).
 */
export async function searchSuggestions(q: string, limit: number): Promise<Suggestion[]> {
  "use cache";
  cached();
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
