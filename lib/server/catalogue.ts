import "server-only";
import {
  filterAndSort,
  matchesKeyword,
  type CatalogueProduct,
  type LookupProduct,
  type ProductQuery,
  type RatingSummary,
  type Suggestion,
} from "@/lib/catalogue";
import { cacheLife, cacheTag } from "next/cache";
import { categories } from "@/lib/data/categories";
import type { Product, Review, Shop } from "@/lib/types";
import { listPublicProducts, listPublicShops, listShops } from "./repositories/catalogue";
import { listReviews, reviewsOfShop, visibleReviewsOfProduct } from "./repositories/content";
import { db } from "./db/tx";
import { CATALOGUE_TAG } from "./catalogue-tag";

// Public catalogue reads. Everything here filters to ACTIVE items of ACTIVE shops (RULE-P4, RULE-S4),
// and ratings count only VISIBLE reviews (RULE-R4).
//
// Caching (B04a): every public read comes from one cached snapshot, tagged CATALOGUE_TAG. Any action that changes
// an item, a shop, a review or a question calls catalogueChanged() (lib/server/actions/refresh.ts), so the next
// visit reads fresh rows. The "hours" lifetime is only a safety net. Admin and seller pages read the database
// directly and never use this snapshot.

function summarize(reviews: Review[]): RatingSummary | undefined {
  const visible = reviews.filter((r) => r.status === "VISIBLE");
  if (!visible.length) return undefined;
  return { average: visible.reduce((s, r) => s + r.rating, 0) / visible.length, count: visible.length };
}

interface PublicSnapshot {
  products: CatalogueProduct[];
  shops: Shop[];
  /** Ratings of public shops by slug. */
  shopRatings: Record<string, RatingSummary | undefined>;
}

async function publicSnapshot(): Promise<PublicSnapshot> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOGUE_TAG);
  const [products, shops, allShops, reviews] = await Promise.all([
    listPublicProducts(db),
    listPublicShops(db),
    listShops(db),
    listReviews(db),
  ]);
  const shopNames = new Map(allShops.map((s) => [s.slug, s.name]));
  return {
    products: products.map((p) => ({
      ...p,
      shopName: shopNames.get(p.shopSlug) ?? "",
      rating: summarize(reviews.filter((r) => r.productId === p.id)),
    })),
    shops,
    shopRatings: Object.fromEntries(shops.map((s) => [s.slug, summarize(reviews.filter((r) => r.shopId === s.id))])),
  };
}

export async function publicCatalogue(): Promise<CatalogueProduct[]> {
  return (await publicSnapshot()).products;
}

export async function queryCatalogue(query: ProductQuery) {
  return filterAndSort(await publicCatalogue(), query);
}

export async function getPublicProduct(slug: string): Promise<CatalogueProduct | undefined> {
  return (await publicCatalogue()).find((p) => p.slug === slug);
}

export async function getPublicShop(slug: string): Promise<Shop | undefined> {
  return (await publicShops()).find((s) => s.slug === slug);
}

export async function publicShops(): Promise<Shop[]> {
  return (await publicSnapshot()).shops;
}

export async function publicProductsOfShop(shopSlug: string): Promise<CatalogueProduct[]> {
  return filterAndSort(
    (await publicCatalogue()).filter((p) => p.shopSlug === shopSlug),
    { sort: "featured" },
  ).items;
}

export async function relatedProducts(p: Product, count = 4): Promise<CatalogueProduct[]> {
  const all = (await publicCatalogue()).filter((x) => x.slug !== p.slug);
  const sameCategory = all.filter((x) => x.categorySlug === p.categorySlug);
  const sameShop = all.filter((x) => x.shopSlug === p.shopSlug && x.categorySlug !== p.categorySlug);
  return [...sameCategory, ...sameShop].slice(0, count);
}

export async function productCountByCategory(slug: string): Promise<number> {
  return (await publicCatalogue()).filter((p) => p.categorySlug === slug).length;
}

/** RULE-R4: an item's visible reviews, newest first, cached with the catalogue. */
export async function publicReviewsOfProduct(productId: string): Promise<Review[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOGUE_TAG);
  return visibleReviewsOfProduct(db, productId);
}

/** A shop's reviews, newest first, cached with the catalogue; the shop page shows only the visible ones. */
export async function publicReviewsOfShop(shopId: string): Promise<Review[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOGUE_TAG);
  return reviewsOfShop(db, shopId);
}

/** A public shop's rating, from the cached snapshot. */
export async function publicShopRating(shopSlug: string): Promise<RatingSummary | undefined> {
  return (await publicSnapshot()).shopRatings[shopSlug];
}

/** Any shop's rating, read fresh: for admin pages, which must always show current data. */
export async function shopRating(shopSlug: string): Promise<RatingSummary | undefined> {
  const shop = (await listShops(db)).find((s) => s.slug === shopSlug);
  return shop ? summarize((await listReviews(db)).filter((r) => r.shopId === shop.id)) : undefined;
}

export async function searchSuggestions(q: string, limit: number): Promise<Suggestion[]> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const fromCategories: Suggestion[] = categories
    .filter((c) => c.name.toLowerCase().includes(needle))
    .map((c) => ({ label: c.name, href: `/c/${c.slug}`, kind: "Category" }));
  const fromShops: Suggestion[] = (await publicShops())
    .filter((s) => s.name.toLowerCase().includes(needle) || s.craft.toLowerCase().includes(needle))
    .map((s) => ({ label: s.name, href: `/shop/${s.slug}`, kind: "Maker" }));
  const fromProducts: Suggestion[] = (await publicCatalogue())
    .filter((p) => matchesKeyword(p, needle))
    .map((p) => ({ label: p.title, href: `/p/${p.slug}`, kind: "Product" }));
  return [...fromCategories, ...fromShops, ...fromProducts].slice(0, limit);
}

/** Public summaries for the given slugs; unknown or hidden items are simply left out. */
export async function lookupProducts(slugs: string[]): Promise<LookupProduct[]> {
  const { products, shops } = await publicSnapshot();
  const shopBySlug = new Map(shops.map((s) => [s.slug, s]));
  return slugs
    .map((slug) => products.find((p) => p.slug === slug))
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
