import "server-only";
import { z } from "zod";
import type { CatalogueProduct, ProductQuery, SortValue } from "@/lib/catalogue";
import { Prisma } from "../db/generated/client";
import { productInclude, toProduct } from "../db/mappers";
import { clientOf, type Tx } from "../db/tx";

// The public catalogue query (backend plan 7.3, B04b): filters, sorts and full-text search run in PostgreSQL, and
// results come in keyset pages, so no request ever loads the whole catalogue. Same rules as the in-memory reference
// in lib/catalogue.ts (filterAndSort), which the tests compare it with: only ACTIVE items of ACTIVE shops
// (RULE-P4, RULE-S4), ratings from VISIBLE reviews only (RULE-R4), the BR-13 weighted rating.
// BE-04: every value reaches SQL as a bound parameter through Prisma.sql; nothing is pasted into the query text.

/** Hard cap on one page, whatever the caller asks for. */
export const MAX_PAGE_SIZE = 200;

const MAX_WORDS = 10;
const MAX_WORD_LENGTH = 40;

/**
 * The search words as a tsquery: every word must match (AND), each as a prefix, so "mask" also finds "masks".
 * Only letters, combining marks (Sinhala vowel signs) and digits survive, so no tsquery operator can get in.
 * Returns undefined when nothing searchable is left.
 */
export function toSearchQuery(q: string): string | undefined {
  const words = (
    q
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  )
    .slice(0, MAX_WORDS)
    .map((word) => word.slice(0, MAX_WORD_LENGTH));
  return words.length ? words.map((word) => `${word}:*`).join(" & ") : undefined;
}

/** Where the next page starts: the sort keys and ID of the last item shown. Opaque to the browser. */
const cursorSchema = z.object({
  sort: z.string().max(40),
  keys: z.array(z.number().finite()).max(4),
  id: z.string().min(1).max(200),
});
type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** A cursor from the URL is never trusted: anything malformed, or made for another sort, means "first page". */
export function decodeCursor(value: string | undefined, sortKey: string, keyCount: number): Cursor | undefined {
  if (!value || value.length > 1000) return undefined;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.sort !== sortKey || parsed.data.keys.length !== keyCount) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export interface CataloguePage {
  items: CatalogueProduct[];
  /** Every match, not just this page. */
  total: number;
  /** Pass back as `after` for the next page; undefined on the last page. */
  next?: string;
}

const sql = Prisma.sql;

// Sort keys, all ascending, so one row comparison works for keyset paging; descending keys are negated.
// The product ID always comes last as the tie-breaker.
// Looked up per item through the variants primary key (product_id, sku), so it stays fast however the plan joins.
const PRICE = sql`(SELECT min(v.price_cents) FROM product_variants v WHERE v.product_id = p.id)::float8`;
const PUBLISHED = sql`extract(epoch FROM p.published_at)::float8`;
const FEATURED = sql`coalesce(p.featured_rank, 999)::float8`;
const ENOUGH_REVIEWS = sql`(CASE WHEN r.count >= 3 THEN 1 ELSE 0 END)::float8`;
// BR-13 Bayesian average, computed exactly as lib/catalogue.ts does (average × count), so ties break the same way.
const WEIGHTED_RATING = sql`((4 * 3 + coalesce(r.sum / nullif(r.count, 0), 0) * r.count) / (3 + r.count))::float8`;

function sortKeys(sort: SortValue, searching: boolean): Prisma.Sql[] {
  const relevance = sql`(-ts_rank(p.search_vector, to_tsquery('simple', q.query)))::float8`;
  switch (sort) {
    case "newest":
      return [sql`-${PUBLISHED}`];
    case "price_asc":
      return [PRICE];
    case "price_desc":
      return [sql`-${PRICE}`];
    case "rating":
      return [sql`-${ENOUGH_REVIEWS}`, sql`-${WEIGHTED_RATING}`];
    default:
      // With search words, the default order puts the best title and tag matches first.
      return searching ? [relevance, FEATURED, sql`-${PUBLISHED}`] : [FEATURED, sql`-${PUBLISHED}`];
  }
}

function filters(query: ProductQuery, searching: boolean): Prisma.Sql[] {
  const where: Prisma.Sql[] = [sql`p.status = 'ACTIVE'`, sql`s.status = 'ACTIVE'`];
  if (searching) {
    // First a cheap, index-backed pre-filter (any one word matches the item, its shop or its category), then the
    // exact rule: every word matches somewhere in the item, its shop's name or its category's English or Sinhala name.
    where.push(sql`(
      p.search_vector @@ to_tsquery('simple', q.any_word)
      OR p.shop_id IN (SELECT id FROM shops WHERE search_vector @@ to_tsquery('simple', q.any_word))
      OR p.category_slug IN (SELECT slug FROM categories WHERE search_vector @@ to_tsquery('simple', q.any_word))
    )`);
    where.push(sql`(p.search_vector || s.search_vector || c.search_vector) @@ to_tsquery('simple', q.query)`);
  }
  if (query.category) where.push(sql`p.category_slug = ${query.category}`);
  if (query.shop) where.push(sql`s.slug = ${query.shop}`);
  if (query.minPrice !== undefined) where.push(sql`${PRICE} >= ${query.minPrice}`);
  if (query.maxPrice !== undefined) where.push(sql`${PRICE} <= ${query.maxPrice}`);
  if (query.style?.length) where.push(sql`p.styles && ${query.style}::"Style"[]`);
  if (query.type) where.push(sql`p.type = ${query.type}::"ProductType"`);
  if (query.customizable !== undefined) where.push(sql`p.is_customizable = ${query.customizable}`);
  if (query.heritage !== undefined) where.push(sql`p.is_heritage = ${query.heritage}`);
  if (query.ecoFriendly !== undefined) where.push(sql`p.is_eco_friendly = ${query.ecoFriendly}`);
  if (query.slugs) where.push(sql`p.slug = ANY(${query.slugs}::text[])`);
  if (query.material?.length) where.push(sql`p.materials && ${query.material}::text[]`);
  if (query.inStock) {
    where.push(
      sql`(p.type = 'MADE_TO_ORDER' OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.stock > 0))`,
    );
  }
  // Fewer than 3 reviews is too few to judge, so those items stay in (as before).
  if (query.minRating) where.push(sql`NOT (r.count >= 3 AND r.sum / r.count < ${query.minRating})`);
  return where;
}

interface Row {
  id: string;
  keys: number[];
  shop_name: string;
  review_count: number;
  review_sum: number;
  total: number;
}

/** One page of public items for `query`, starting after `after` (a cursor from the previous page). */
export async function queryPublicProducts(tx: Tx, query: ProductQuery, after?: string): Promise<CataloguePage> {
  const tsquery = query.q === undefined ? undefined : toSearchQuery(query.q);
  if (query.q !== undefined && !tsquery) return { items: [], total: 0 };
  const searching = tsquery !== undefined;
  const sort = query.sort ?? "featured";
  const keys = sortKeys(sort, searching);
  const sortKey = `${sort}${searching ? ":search" : ""}`;
  const cursor = decodeCursor(after, sortKey, keys.length);
  const limit = Math.max(1, Math.min(query.limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE));

  const keyList = Prisma.join(keys.map((key, i) => sql`${key} AS ${Prisma.raw(`k${i}`)}`));
  const keyColumns = Prisma.join(keys.map((_, i) => Prisma.raw(`k${i}`)));
  const afterCursor = cursor
    ? sql`WHERE (${keyColumns}, id) > (${Prisma.join(cursor.keys.map((k) => sql`${k}::float8`))}, ${cursor.id})`
    : Prisma.empty;

  const rows = await clientOf(tx).$queryRaw<Row[]>`
    WITH q AS (SELECT ${tsquery ?? ""}::text AS query, ${tsquery?.replaceAll(" & ", " | ") ?? ""}::text AS any_word),
    matched AS (
      SELECT p.id, s.name AS shop_name, r.count AS review_count, r.sum AS review_sum, ${keyList}
      FROM products p
      JOIN shops s ON s.id = p.shop_id
      JOIN categories c ON c.slug = p.category_slug
      CROSS JOIN q
      -- Visible-review totals, computed once for all items (not once per item).
      LEFT JOIN (
        SELECT product_id, count(*)::int AS count, sum(rating)::float8 AS sum
        FROM reviews WHERE status = 'VISIBLE' GROUP BY product_id
      ) rv ON rv.product_id = p.id
      CROSS JOIN LATERAL (SELECT coalesce(rv.count, 0) AS count, coalesce(rv.sum, 0)::float8 AS sum) r
      WHERE ${Prisma.join(filters(query, searching), " AND ")}
    )
    SELECT id, shop_name, review_count, review_sum, ARRAY[${keyColumns}] AS keys,
           (SELECT count(*)::int FROM matched) AS total
    FROM matched
    ${afterCursor}
    ORDER BY ${keyColumns}, id
    LIMIT ${limit + 1}`;

  const page = rows.slice(0, limit);
  const products = await clientOf(tx).product.findMany({
    where: { id: { in: page.map((row) => row.id) } },
    include: productInclude,
  });
  const byId = new Map(products.map((product) => [product.id, toProduct(product)]));
  const items = page.flatMap((row): CatalogueProduct[] => {
    const product = byId.get(row.id);
    if (!product) return []; // removed between the two reads
    const rating = row.review_count
      ? { average: row.review_sum / row.review_count, count: row.review_count }
      : undefined;
    return [{ ...product, shopName: row.shop_name, rating }];
  });
  const last = page.at(-1);
  return {
    items,
    total: rows[0]?.total ?? (cursor ? await countPublicProducts(tx, query) : 0),
    next: rows.length > limit && last ? encodeCursor({ sort: sortKey, keys: last.keys, id: last.id }) : undefined,
  };
}

/** How many public items match `query` (for counts, and for a page past the last match). */
export async function countPublicProducts(tx: Tx, query: ProductQuery): Promise<number> {
  return (await queryPublicProducts(tx, { ...query, limit: 1 })).total;
}

/** Totals of a shop's VISIBLE reviews (RULE-R4), counted in the database. */
export async function shopReviewTotals(tx: Tx, shopId: string): Promise<{ count: number; sum: number }> {
  const totals = await clientOf(tx).review.aggregate({
    where: { shopId, status: "VISIBLE" },
    _count: { _all: true },
    _sum: { rating: true },
  });
  return { count: totals._count._all, sum: totals._sum.rating ?? 0 };
}

/** Public shops whose name matches every search word (as prefixes), for search suggestions. */
export async function searchPublicShops(tx: Tx, q: string, limit: number): Promise<{ slug: string; name: string }[]> {
  const tsquery = toSearchQuery(q);
  if (!tsquery) return [];
  return clientOf(tx).$queryRaw<{ slug: string; name: string }[]>`
    SELECT slug, name FROM shops
    WHERE status = 'ACTIVE' AND search_vector @@ to_tsquery('simple', ${tsquery})
    ORDER BY name, id
    LIMIT ${Math.min(limit, MAX_PAGE_SIZE)}`;
}

/**
 * Typo-tolerant fallback for suggestions (pg_trgm): public items whose title contains a word close to `q`,
 * for example "batk" finds "batik". Uses the trigram index on products.title.
 */
export async function similarPublicProducts(
  tx: Tx,
  q: string,
  limit: number,
): Promise<{ slug: string; title: string }[]> {
  const needle = q.normalize("NFC").trim().slice(0, 100);
  if (needle.length < 3) return [];
  return clientOf(tx).$queryRaw<{ slug: string; title: string }[]>`
    SELECT p.slug, p.title FROM products p JOIN shops s ON s.id = p.shop_id
    WHERE p.status = 'ACTIVE' AND s.status = 'ACTIVE' AND ${needle} <% p.title
    ORDER BY word_similarity(${needle}, p.title) DESC, p.id
    LIMIT ${Math.min(limit, MAX_PAGE_SIZE)}`;
}

/** Every public item's address and last change, for the sitemap and prerendered pages. Reads two columns only. */
export async function publicProductPaths(tx: Tx): Promise<{ slug: string; updatedAt: string }[]> {
  const rows = await clientOf(tx).product.findMany({
    where: { status: "ACTIVE", shop: { status: "ACTIVE" } },
    select: { slug: true, updatedAt: true },
    orderBy: { slug: "asc" },
  });
  return rows.map((row) => ({ slug: row.slug, updatedAt: row.updatedAt.toISOString() }));
}
