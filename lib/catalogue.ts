import { categories } from "./data/categories";
import type { Material, Photo, Product, ProductType, Style } from "./types";

// Catalogue rules that are safe in the browser: labels, query parsing, filtering and sorting of a given list.
// Reading the catalogue itself happens on the server (lib/server/catalogue.ts), which only returns public items.

export const STYLES: Style[] = ["MODERN", "TRADITIONAL", "MINIMAL", "COLOURFUL", "RUSTIC", "CULTURAL"];
export const MATERIALS: Material[] = ["wood", "fabric", "clay", "resin", "metal", "natural-fibre", "recycled", "other"];

export const STYLE_LABELS: Record<Style, string> = {
  MODERN: "Modern",
  TRADITIONAL: "Traditional",
  MINIMAL: "Minimal",
  COLOURFUL: "Colourful",
  RUSTIC: "Rustic",
  CULTURAL: "Cultural",
};

export const MATERIAL_LABELS: Record<Material, string> = {
  wood: "Wood",
  fabric: "Fabric",
  clay: "Clay",
  resin: "Resin",
  metal: "Metal",
  "natural-fibre": "Natural fibre",
  recycled: "Recycled",
  other: "Other",
};

export const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Best rated" },
] as const;

export type SortValue = (typeof SORTS)[number]["value"];

export interface RatingSummary {
  average: number;
  count: number;
}

/** A public product as the storefront shows it: with its shop name and rating from visible reviews (RULE-R4). */
export type CatalogueProduct = Product & { shopName: string; rating?: RatingSummary };

/** The small product summary the browser fetches for the cart, wishlist and recently viewed. */
export interface LookupProduct {
  slug: string;
  title: string;
  image: Photo;
  type: ProductType;
  isCustomizable: boolean;
  variants: Product["variants"];
  customizationLabels: Record<string, string>;
  shop: { slug: string; name: string; dispatchDays: string };
}

export interface Suggestion {
  label: string;
  href: string;
  kind: "Product" | "Category" | "Maker";
}

export interface ProductQuery {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  style?: Style[];
  type?: ProductType;
  customizable?: boolean;
  material?: Material[];
  inStock?: boolean;
  minRating?: number;
  sort?: SortValue;
  limit?: number;
}

export function lowestPriceCents(p: Pick<Product, "variants">): number {
  return Math.min(...p.variants.map((v) => v.priceCents));
}

export function highestCompareAtCents(p: Pick<Product, "variants">): number | undefined {
  const v = p.variants.find((x) => x.compareAtPriceCents && x.compareAtPriceCents > x.priceCents);
  return v?.compareAtPriceCents;
}

export function isAvailable(p: Pick<Product, "type" | "variants">): boolean {
  return p.type === "MADE_TO_ORDER" || p.variants.some((v) => v.stock > 0);
}

export function isNew(p: Pick<Product, "publishedAt">): boolean {
  const days = (Date.parse("2026-10-22") - Date.parse(p.publishedAt)) / 86_400_000;
  return days <= 14;
}

/** Bayesian average so a single five-star review can't outrank a well-reviewed product (BR-13). */
function bayesianRating(p: CatalogueProduct): number {
  const prior = 4;
  const weight = 3;
  const count = p.rating?.count ?? 0;
  const total = (p.rating?.average ?? 0) * count;
  return (prior * weight + total) / (weight + count);
}

export function matchesKeyword(p: CatalogueProduct, q: string): boolean {
  const category = categories.find((c) => c.slug === p.categorySlug);
  const haystack = [
    p.title,
    p.description,
    p.materialNote,
    p.subcategory,
    category?.name,
    p.shopName,
    ...p.tags,
    ...p.materials,
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function matchesFilters(p: CatalogueProduct, query: ProductQuery): boolean {
  const price = lowestPriceCents(p);
  if (query.q && !matchesKeyword(p, query.q)) return false;
  if (query.category && p.categorySlug !== query.category) return false;
  if (query.minPrice !== undefined && price < query.minPrice) return false;
  if (query.maxPrice !== undefined && price > query.maxPrice) return false;
  if (query.style?.length && !query.style.some((s) => p.styles.includes(s))) return false;
  if (query.type && p.type !== query.type) return false;
  if (query.customizable !== undefined && p.isCustomizable !== query.customizable) return false;
  if (query.material?.length && !query.material.some((m) => p.materials.includes(m))) return false;
  if (query.inStock && !isAvailable(p)) return false;
  if (query.minRating && (p.rating?.count ?? 0) >= 3 && (p.rating?.average ?? 0) < query.minRating) return false;
  return true;
}

const sorters: Record<SortValue, (a: CatalogueProduct, b: CatalogueProduct) => number> = {
  featured: (a, b) => (a.featuredRank ?? 999) - (b.featuredRank ?? 999) || b.publishedAt.localeCompare(a.publishedAt),
  newest: (a, b) => b.publishedAt.localeCompare(a.publishedAt),
  price_asc: (a, b) => lowestPriceCents(a) - lowestPriceCents(b),
  price_desc: (a, b) => lowestPriceCents(b) - lowestPriceCents(a),
  rating: (a, b) => {
    const aEnough = (a.rating?.count ?? 0) >= 3 ? 1 : 0;
    const bEnough = (b.rating?.count ?? 0) >= 3 ? 1 : 0;
    return bEnough - aEnough || bayesianRating(b) - bayesianRating(a);
  },
};

export function filterAndSort(list: CatalogueProduct[], query: ProductQuery) {
  const filtered = list.filter((p) => matchesFilters(p, query)).sort(sorters[query.sort ?? "featured"]);
  const limit = query.limit ?? filtered.length;
  return { items: filtered.slice(0, limit), total: filtered.length, hasMore: filtered.length > limit };
}

export function sortProducts(list: CatalogueProduct[], sort: SortValue): CatalogueProduct[] {
  return [...list].sort(sorters[sort]);
}

/** Parses URL search params into a validated query; anything malformed is dropped rather than trusted. */
export function parseProductQuery(params: Record<string, string | string[] | undefined>): ProductQuery {
  const one = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const many = (key: string) => {
    const v = params[key];
    const list = Array.isArray(v) ? v : v ? v.split(",") : [];
    return list.filter(Boolean);
  };
  const int = (key: string) => {
    const n = Number(one(key));
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  const bool = (key: string) => (one(key) === "true" ? true : one(key) === "false" ? false : undefined);

  const q = one("q")?.trim();
  const sort = one("sort");
  let minPrice = int("minPrice");
  let maxPrice = int("maxPrice");
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)
    [minPrice, maxPrice] = [maxPrice, minPrice];

  return {
    q: q && q.length >= 2 ? q.slice(0, 100) : undefined,
    category: categories.some((c) => c.slug === one("category")) ? one("category") : undefined,
    minPrice,
    maxPrice,
    style: many("style").filter((s): s is Style => STYLES.includes(s as Style)),
    type: one("type") === "READY_TO_SHIP" || one("type") === "MADE_TO_ORDER" ? (one("type") as ProductType) : undefined,
    customizable: bool("customizable"),
    material: many("material").filter((m): m is Material => MATERIALS.includes(m as Material)),
    inStock: bool("inStock"),
    minRating: int("minRating"),
    sort: SORTS.some((s) => s.value === sort) ? (sort as SortValue) : "featured",
    limit: Math.min(int("limit") ?? 0, 200) || undefined,
  };
}

export { categories };
