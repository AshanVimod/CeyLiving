// BE-09 (B13): the cache tags on the public catalogue reads (lib/server/catalogue.ts), and which of them a change
// refreshes. Tags are built from stored values (IDs and slugs read from the database), never from browser input.
// Each change uses the identifier it already has: an item knows its shop's slug, a review its shop's ID.
//
// Every cached read carries CATALOGUE_TAG, so the whole catalogue can still be refreshed at once (the worker's
// catalogue.refresh route, a shop going live, rare shop-wide changes). Beyond that:
//   product:{id}         the item's own read, and every list entry that shows the item
//   category:{slug}      lists filtered by that category (category pages, "related" blocks)
//   shop:{slug}          the shop's own read and lists filtered by that shop
//   shop-reviews:{id}    what the shop's reviews feed: its rating, its latest reviews, the makers stats
//   reviews:{productId}  the item's cached review list
//   products             site-wide lists (home, search, suggestions, counts, sitemap) and a slug that found nothing
//   shops                the public shop list and a shop slug that found nothing

/** The tag on every cached catalogue read. */
export const CATALOGUE_TAG = "catalogue";
export const PRODUCTS_TAG = "products";
export const SHOPS_TAG = "shops";

export const productTag = (productId: string) => `product:${productId}`;
export const shopTag = (shopSlug: string) => `shop:${shopSlug}`;
export const shopReviewsTag = (shopId: string) => `shop-reviews:${shopId}`;
export const categoryTag = (categorySlug: string) => `category:${categorySlug}`;
export const reviewsTag = (productId: string) => `reviews:${productId}`;

/** A change that public catalogue pages show. */
export type CatalogueChange =
  /** An item was saved, archived, restored or decided by an admin: its page, its shop, its category, every list. */
  | { kind: "product"; productId: string; shopSlug: string; categorySlug: string }
  /** An order took stock: the ordered items' pages and the lists that show them. */
  | { kind: "stock"; productIds: string[] }
  /** A review was posted, edited, replied to or moderated: the item's reviews and rating, and its shop's. */
  | { kind: "review"; productId: string; shopId: string }
  /** A shop's name, details or status, or an author's name on posts: shown on every list, so everything. */
  | { kind: "everything" };

/** The tags a change refreshes, without duplicates. */
export function tagsFor(change: CatalogueChange): string[] {
  switch (change.kind) {
    case "product":
      return [productTag(change.productId), shopTag(change.shopSlug), categoryTag(change.categorySlug), PRODUCTS_TAG];
    case "stock":
      return [...new Set(change.productIds)].map(productTag);
    case "review":
      return [reviewsTag(change.productId), productTag(change.productId), shopReviewsTag(change.shopId)];
    case "everything":
      return [CATALOGUE_TAG];
  }
}
