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
import { categories } from "@/lib/data/categories";
import type { Product, Review, Shop } from "@/lib/types";
import {
  findPublicProductBySlug,
  findPublicShopBySlug,
  listPublicProducts,
  listPublicShops,
} from "./repositories/catalogue";
import { readStore, type StoreData } from "./store/dev-store";

// Public catalogue reads. Everything here filters to ACTIVE items of ACTIVE shops (RULE-P4, RULE-S4),
// and ratings count only VISIBLE reviews (RULE-R4).

function summarize(reviews: Review[]): RatingSummary | undefined {
  const visible = reviews.filter((r) => r.status === "VISIBLE");
  if (!visible.length) return undefined;
  return { average: visible.reduce((s, r) => s + r.rating, 0) / visible.length, count: visible.length };
}

function decorate(products: Product[], db: StoreData): CatalogueProduct[] {
  const shopNames = new Map(db.shops.map((s) => [s.slug, s.name]));
  return products.map((p) => ({
    ...p,
    shopName: shopNames.get(p.shopSlug) ?? "",
    rating: summarize(db.reviews.filter((r) => r.productId === p.id)),
  }));
}

export function publicCatalogue(db: StoreData = readStore()): CatalogueProduct[] {
  return decorate(listPublicProducts(db), db);
}

export function queryCatalogue(query: ProductQuery) {
  return filterAndSort(publicCatalogue(), query);
}

export function getPublicProduct(slug: string): CatalogueProduct | undefined {
  const db = readStore();
  const product = findPublicProductBySlug(slug, db);
  return product ? decorate([product], db)[0] : undefined;
}

export function getPublicShop(slug: string): Shop | undefined {
  return findPublicShopBySlug(slug);
}

export function publicShops(): Shop[] {
  return listPublicShops();
}

export function publicProductsOfShop(shopSlug: string): CatalogueProduct[] {
  return filterAndSort(
    publicCatalogue().filter((p) => p.shopSlug === shopSlug),
    { sort: "featured" },
  ).items;
}

export function relatedProducts(p: Product, count = 4): CatalogueProduct[] {
  const all = publicCatalogue().filter((x) => x.slug !== p.slug);
  const sameCategory = all.filter((x) => x.categorySlug === p.categorySlug);
  const sameShop = all.filter((x) => x.shopSlug === p.shopSlug && x.categorySlug !== p.categorySlug);
  return [...sameCategory, ...sameShop].slice(0, count);
}

export function productCountByCategory(slug: string): number {
  return listPublicProducts().filter((p) => p.categorySlug === slug).length;
}

export function shopRating(shopSlug: string): RatingSummary | undefined {
  const db = readStore();
  const shop = db.shops.find((s) => s.slug === shopSlug);
  return shop ? summarize(db.reviews.filter((r) => r.shopId === shop.id)) : undefined;
}

export function searchSuggestions(q: string, limit: number): Suggestion[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const fromCategories: Suggestion[] = categories
    .filter((c) => c.name.toLowerCase().includes(needle))
    .map((c) => ({ label: c.name, href: `/c/${c.slug}`, kind: "Category" }));
  const fromShops: Suggestion[] = listPublicShops()
    .filter((s) => s.name.toLowerCase().includes(needle) || s.craft.toLowerCase().includes(needle))
    .map((s) => ({ label: s.name, href: `/shop/${s.slug}`, kind: "Maker" }));
  const fromProducts: Suggestion[] = publicCatalogue()
    .filter((p) => matchesKeyword(p, needle))
    .map((p) => ({ label: p.title, href: `/p/${p.slug}`, kind: "Product" }));
  return [...fromCategories, ...fromShops, ...fromProducts].slice(0, limit);
}

/** Public summaries for the given slugs; unknown or hidden items are simply left out. */
export function lookupProducts(slugs: string[]): LookupProduct[] {
  const db = readStore();
  const shops = new Map(db.shops.map((s) => [s.slug, s]));
  return slugs
    .map((slug) => findPublicProductBySlug(slug, db))
    .filter((p): p is Product => Boolean(p))
    .map((p) => {
      const shop = shops.get(p.shopSlug)!;
      return {
        slug: p.slug,
        title: p.title,
        image: p.images[0]!,
        type: p.type,
        isCustomizable: p.isCustomizable,
        variants: p.variants,
        customizationLabels: Object.fromEntries((p.customization ?? []).map((f) => [f.key, f.label.replace(" (optional)", "")])),
        shop: { slug: shop.slug, name: shop.name, dispatchDays: shop.dispatchDays },
      };
    });
}
