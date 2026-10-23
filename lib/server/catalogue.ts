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
  listShops,
} from "./repositories/catalogue";
import { listReviews } from "./repositories/content";
import { db, type Tx } from "./db/tx";

// Public catalogue reads. Everything here filters to ACTIVE items of ACTIVE shops (RULE-P4, RULE-S4),
// and ratings count only VISIBLE reviews (RULE-R4).

function summarize(reviews: Review[]): RatingSummary | undefined {
  const visible = reviews.filter((r) => r.status === "VISIBLE");
  if (!visible.length) return undefined;
  return { average: visible.reduce((s, r) => s + r.rating, 0) / visible.length, count: visible.length };
}

async function decorate(products: Product[], tx: Tx): Promise<CatalogueProduct[]> {
  const shopNames = new Map((await listShops(tx)).map((s) => [s.slug, s.name]));
  const reviews = await listReviews(tx);
  return products.map((p) => ({
    ...p,
    shopName: shopNames.get(p.shopSlug) ?? "",
    rating: summarize(reviews.filter((r) => r.productId === p.id)),
  }));
}

export async function publicCatalogue(tx: Tx = db): Promise<CatalogueProduct[]> {
  return decorate(await listPublicProducts(tx), tx);
}

export async function queryCatalogue(query: ProductQuery) {
  return filterAndSort(await publicCatalogue(), query);
}

export async function getPublicProduct(slug: string): Promise<CatalogueProduct | undefined> {
  const product = await findPublicProductBySlug(db, slug);
  return product ? (await decorate([product], db))[0] : undefined;
}

export async function getPublicShop(slug: string): Promise<Shop | undefined> {
  return findPublicShopBySlug(db, slug);
}

export async function publicShops(): Promise<Shop[]> {
  return listPublicShops(db);
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
  return (await listPublicProducts(db)).filter((p) => p.categorySlug === slug).length;
}

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
  const fromShops: Suggestion[] = (await listPublicShops(db))
    .filter((s) => s.name.toLowerCase().includes(needle) || s.craft.toLowerCase().includes(needle))
    .map((s) => ({ label: s.name, href: `/shop/${s.slug}`, kind: "Maker" }));
  const fromProducts: Suggestion[] = (await publicCatalogue())
    .filter((p) => matchesKeyword(p, needle))
    .map((p) => ({ label: p.title, href: `/p/${p.slug}`, kind: "Product" }));
  return [...fromCategories, ...fromShops, ...fromProducts].slice(0, limit);
}

/** Public summaries for the given slugs; unknown or hidden items are simply left out. */
export async function lookupProducts(slugs: string[]): Promise<LookupProduct[]> {
  const shops = new Map((await listShops(db)).map((s) => [s.slug, s]));
  const found = await Promise.all(slugs.map((slug) => findPublicProductBySlug(db, slug)));
  return found
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
        customizationLabels: Object.fromEntries(
          (p.customization ?? []).map((f) => [f.key, f.label.replace(" (optional)", "")]),
        ),
        shop: { slug: shop.slug, name: shop.name, dispatchDays: shop.dispatchDays },
      };
    });
}
