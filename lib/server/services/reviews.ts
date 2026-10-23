import "server-only";
import { REVIEW_EDIT_DAYS } from "@/lib/config";
import type { OrderItem, Review } from "@/lib/types";
import type { EditReviewInput, ReviewInput } from "@/lib/validation/content";
import { db, withTx, type Tx } from "../db/tx";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertCanPost, assertShopOwner, type Actor } from "../permissions";
import { findProductById, findShopById, findShopBySlug } from "../repositories/catalogue";
import {
  findOrderById,
  findOrderItem,
  findSellerOrder,
  itemsOfSellerOrders,
  sellerOrdersOfCustomer,
} from "../repositories/commerce";
import {
  findReview,
  insertReview,
  reviewedOrderItemIds,
  reviewForOrderItem,
  reviewsByAuthor,
  updateReview,
} from "../repositories/content";
import { addNotification, newId } from "../repositories/people";
import { assertRateLimit } from "./shared";

/** Order items the actor bought, delivered and not yet reviewed (RULE-R1), optionally for one product. */
export async function reviewableItems(actor: Actor, tx: Tx = db, productId?: string): Promise<OrderItem[]> {
  const delivered = (await sellerOrdersOfCustomer(tx, actor.id)).filter((so) => so.status === "COMPLETED");
  const reviewed = await reviewedOrderItemIds(tx);
  return (
    await itemsOfSellerOrders(
      tx,
      delivered.map((so) => so.id),
    )
  ).filter((i) => !reviewed.has(i.id) && (!productId || i.productId === productId));
}

export type ReviewEligibility = { canReview: true; orderItemId: string } | { canReview: false; reason: string };

/** What the product page tells this person about reviewing (FR-3a). */
export async function reviewEligibility(
  actor: Actor | null,
  productId: string,
  tx: Tx = db,
): Promise<ReviewEligibility> {
  const fallback = { canReview: false as const, reason: "Only customers who received this item can review it." };
  if (!actor) return fallback;
  const product = await findProductById(tx, productId);
  const shop = product ? await findShopBySlug(tx, product.shopSlug) : undefined;
  if (shop?.ownerId === actor.id) return { canReview: false, reason: "You can’t review items from your own shop." };
  const item = (await reviewableItems(actor, tx, productId))[0];
  if (item) return { canReview: true, orderItemId: item.id };
  const alreadyReviewed = (await reviewsByAuthor(tx, actor.id)).some((r) => r.productId === productId);
  return alreadyReviewed ? { canReview: false, reason: "You’ve reviewed this item. Thank you." } : fallback;
}

/** RULE-R1: a review needs the author's own delivered order item, once. RULE-R3: never the seller's own items. */
export async function createReview(actor: Actor, input: ReviewInput, now = new Date()): Promise<Review> {
  assertCanPost(actor, now);
  return withTx(async (tx) => {
    const item = await findOrderItem(tx, input.orderItemId);
    const sellerOrder = item ? await findSellerOrder(tx, item.sellerOrderId) : undefined;
    const order = sellerOrder ? await findOrderById(tx, sellerOrder.orderId) : undefined;
    if (!item || !sellerOrder || !order || order.customerId !== actor.id)
      throw new NotFoundError("We couldn’t find that order item.");
    const shop = await findShopById(tx, sellerOrder.shopId);
    if (shop?.ownerId === actor.id) throw new ForbiddenError("You can’t review items from your own shop.");
    if (sellerOrder.status !== "COMPLETED")
      throw new ConflictError("You can review this item once it has been delivered.");
    if (await reviewForOrderItem(tx, item.id)) throw new ConflictError("You’ve already reviewed this item.");
    await assertRateLimit(tx, actor.id, "review", now);
    const review = await insertReview(tx, {
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
    });
    if (shop)
      await addNotification(
        tx,
        shop.ownerId,
        "review.created",
        `New ${input.rating}-star review on ${item.productTitle}`,
        "/seller/reviews",
      );
    return review;
  });
}

/** RULE-R2: the author can edit for 30 days; each edit is marked. */
export async function editReview(actor: Actor, input: EditReviewInput, now = new Date()): Promise<Review> {
  assertCanPost(actor, now);
  return withTx(async (tx) => {
    const review = await findReview(tx, input.reviewId);
    if (!review || review.authorId !== actor.id || review.status === "DELETED")
      throw new NotFoundError("Review not found.");
    if (now.getTime() - Date.parse(review.createdAt) > REVIEW_EDIT_DAYS * 86_400_000) {
      throw new ConflictError(`Reviews can be edited for ${REVIEW_EDIT_DAYS} days after posting.`);
    }
    return (await updateReview(tx, review.id, {
      rating: input.rating,
      comment: input.comment,
      editedAt: now.toISOString(),
    }))!;
  });
}

/** RULE-R3 / FR-18: the shop's seller replies once (and may edit that reply), but never edits or hides the review. */
export async function replyToReview(actor: Actor, reviewId: string, body: string, now = new Date()): Promise<Review> {
  assertCanPost(actor, now);
  return withTx(async (tx) => {
    const review = await findReview(tx, reviewId);
    if (!review || review.status === "DELETED") throw new NotFoundError("Review not found.");
    await assertShopOwner(actor, review.shopId, tx);
    if (!review.sellerReply) await assertRateLimit(tx, actor.id, "reply", now);
    const updated = (await updateReview(tx, review.id, { sellerReply: body, sellerRepliedAt: now.toISOString() }))!;
    const product = await findProductById(tx, review.productId);
    await addNotification(
      tx,
      review.authorId,
      "review.replied",
      "The maker replied to your review",
      `/p/${product?.slug ?? ""}#review-${review.id}`,
    );
    return updated;
  });
}
