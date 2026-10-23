import "server-only";
import { REVIEW_EDIT_DAYS } from "@/lib/config";
import type { OrderItem, Review } from "@/lib/types";
import type { EditReviewInput, ReviewInput } from "@/lib/validation/content";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertCanPost, assertShopOwner, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { readStore, transaction, type StoreData } from "../store/dev-store";
import { assertRateLimit } from "./shared";

/** Order items the actor bought, delivered and not yet reviewed (RULE-R1), optionally for one product. */
export function reviewableItems(actor: Actor, db: StoreData = readStore(), productId?: string): OrderItem[] {
  const myOrders = new Set(db.orders.filter((o) => o.customerId === actor.id).map((o) => o.id));
  const delivered = new Set(db.sellerOrders.filter((so) => so.status === "COMPLETED" && myOrders.has(so.orderId)).map((so) => so.id));
  const reviewed = new Set(db.reviews.map((r) => r.orderItemId).filter(Boolean));
  return db.orderItems.filter((i) => delivered.has(i.sellerOrderId) && !reviewed.has(i.id) && (!productId || i.productId === productId));
}

export type ReviewEligibility = { canReview: true; orderItemId: string } | { canReview: false; reason: string };

/** What the product page tells this person about reviewing (FR-3a). */
export function reviewEligibility(actor: Actor | null, productId: string, db: StoreData = readStore()): ReviewEligibility {
  const fallback = { canReview: false as const, reason: "Only customers who received this item can review it." };
  if (!actor) return fallback;
  const product = db.products.find((p) => p.id === productId);
  const ownShop = db.shops.find((s) => s.ownerId === actor.id && s.slug === product?.shopSlug);
  if (ownShop) return { canReview: false, reason: "You can’t review items from your own shop." };
  const item = reviewableItems(actor, db, productId)[0];
  if (item) return { canReview: true, orderItemId: item.id };
  const alreadyReviewed = db.reviews.some((r) => r.authorId === actor.id && r.productId === productId);
  return alreadyReviewed ? { canReview: false, reason: "You’ve reviewed this item. Thank you." } : fallback;
}

/** RULE-R1: a review needs the author's own delivered order item, once. RULE-R3: never the seller's own items. */
export async function createReview(actor: Actor, input: ReviewInput, now = new Date()): Promise<Review> {
  assertCanPost(actor, now);
  return transaction((db) => {
    const item = db.orderItems.find((i) => i.id === input.orderItemId);
    const sellerOrder = item ? db.sellerOrders.find((so) => so.id === item.sellerOrderId) : undefined;
    const order = sellerOrder ? db.orders.find((o) => o.id === sellerOrder.orderId) : undefined;
    if (!item || !sellerOrder || !order || order.customerId !== actor.id) throw new NotFoundError("We couldn’t find that order item.");
    const shop = db.shops.find((s) => s.id === sellerOrder.shopId);
    if (shop?.ownerId === actor.id) throw new ForbiddenError("You can’t review items from your own shop.");
    if (sellerOrder.status !== "COMPLETED") throw new ConflictError("You can review this item once it has been delivered.");
    if (db.reviews.some((r) => r.orderItemId === item.id)) throw new ConflictError("You’ve already reviewed this item.");
    assertRateLimit(db, actor.id, "review", now);
    const review: Review = {
      id: newId("review"),
      productId: item.productId,
      shopId: sellerOrder.shopId,
      orderItemId: item.id,
      authorId: actor.id,
      authorName: actor.name,
      rating: input.rating,
      comment: input.comment,
      status: "VISIBLE",
      createdAt: now.toISOString(),
    };
    db.reviews.push(review);
    if (shop) addNotification(db, shop.ownerId, "review.created", `New ${input.rating}-star review on ${item.productTitle}`, "/seller/reviews");
    return review;
  });
}

/** RULE-R2: the author can edit for 30 days; each edit is marked. */
export async function editReview(actor: Actor, input: EditReviewInput, now = new Date()): Promise<Review> {
  assertCanPost(actor, now);
  return transaction((db) => {
    const review = db.reviews.find((r) => r.id === input.reviewId && r.authorId === actor.id);
    if (!review || review.status === "DELETED") throw new NotFoundError("Review not found.");
    if (now.getTime() - Date.parse(review.createdAt) > REVIEW_EDIT_DAYS * 86_400_000) {
      throw new ConflictError(`Reviews can be edited for ${REVIEW_EDIT_DAYS} days after posting.`);
    }
    Object.assign(review, { rating: input.rating, comment: input.comment, editedAt: now.toISOString() });
    return review;
  });
}

/** RULE-R3 / FR-18: the shop's seller replies once (and may edit that reply), but never edits or hides the review. */
export async function replyToReview(actor: Actor, reviewId: string, body: string, now = new Date()): Promise<Review> {
  assertCanPost(actor, now);
  return transaction((db) => {
    const review = db.reviews.find((r) => r.id === reviewId && r.status !== "DELETED");
    if (!review) throw new NotFoundError("Review not found.");
    assertShopOwner(actor, review.shopId, db);
    if (!review.sellerReply) assertRateLimit(db, actor.id, "reply", now);
    Object.assign(review, { sellerReply: body, sellerRepliedAt: now.toISOString() });
    addNotification(db, review.authorId, "review.replied", "The maker replied to your review", `/p/${db.products.find((p) => p.id === review.productId)?.slug ?? ""}#review-${review.id}`);
    return review;
  });
}
