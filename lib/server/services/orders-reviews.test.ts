// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getPublicProduct } from "../catalogue";
import { orderTransitionSchema } from "@/lib/validation/order";
import { reviewSchema } from "@/lib/validation/content";
import { withTestStore, user } from "@/test/store-helpers";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { readStore, transaction } from "../store/dev-store";
import { buyerContactFor, confirmDelivery, customerOrder, transitionSellerOrder } from "./orders";
import { createReview, editReview, replyToReview, reviewEligibility } from "./reviews";
import type { SellerOrderStatus } from "@/lib/types";

withTestStore();

const NEW_ORDER = "so_000114"; // elephant set, Ambalangoda, NEW
const DISPATCHED = "so_000113"; // Mayura mask, Ambalangoda, DISPATCHED
const DELIVERED_ITEM = "item_000112"; // macramé hanger, delivered, not reviewed

async function setStatus(id: string, status: SellerOrderStatus) {
  await transaction((db) => {
    db.sellerOrders.find((s) => s.id === id)!.status = status;
  });
}

describe("FR-7 seller orders (BR-07)", () => {
  const moves: [SellerOrderStatus, SellerOrderStatus, boolean][] = [
    ["NEW", "ACCEPTED", true],
    ["NEW", "IN_PROGRESS", false],
    ["NEW", "DISPATCHED", false],
    ["ACCEPTED", "IN_PROGRESS", true],
    ["ACCEPTED", "DISPATCHED", true],
    ["IN_PROGRESS", "DISPATCHED", true],
    ["IN_PROGRESS", "ACCEPTED", false],
    ["DISPATCHED", "CANCELLED", false],
    ["COMPLETED", "CANCELLED", false],
    ["CANCELLED", "ACCEPTED", false],
  ];

  it.each(moves)("BR-07 %s → %s allowed: %s", async (from, to, allowed) => {
    await setStatus(NEW_ORDER, from);
    const input = orderTransitionSchema.parse({ sellerOrderId: NEW_ORDER, to, courierName: "Pronto Lanka", reason: "Out of stock, sorry." });
    const attempt = transitionSellerOrder(user("user_seller"), input);
    if (allowed) await expect(attempt).resolves.toMatchObject({ status: to });
    else await expect(attempt).rejects.toBeInstanceOf(ConflictError);
  });

  it("dispatch needs a courier name", () => {
    expect(orderTransitionSchema.safeParse({ sellerOrderId: NEW_ORDER, to: "DISPATCHED" }).success).toBe(false);
  });

  it("a seller sees and moves only their own shop's orders", async () => {
    const other = readStore().sellerOrders.find((s) => s.shopId === "shop_nool-and-knot")!;
    await expect(transitionSellerOrder(user("user_seller"), { sellerOrderId: other.id, to: "ACCEPTED" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("SEC-A5 a customer can't open someone else's order", () => {
    const theirs = readStore().orders.find((o) => o.customerId !== "user_customer")!;
    expect(() => customerOrder(user("user_customer"), theirs.orderNumber)).toThrow(NotFoundError);
  });

  it("SEC-A10 buyer details disappear 30 days after delivery", () => {
    const db = readStore();
    const so = { ...db.sellerOrders.find((s) => s.id === DISPATCHED)!, status: "COMPLETED" as const, completedAt: "2026-01-01T00:00:00.000Z" };
    const order = db.orders.find((o) => o.id === so.orderId)!;
    expect(buyerContactFor(so, order, new Date("2026-01-20"))).toBeDefined();
    expect(buyerContactFor(so, order, new Date("2026-03-01"))).toBeUndefined();
  });
});

describe("FR-3a reviews", () => {
  it("RULE-R1 blocks a review without a delivered order", async () => {
    const naga = getPublicProduct("naga-raksha-mask")!;
    expect(reviewEligibility(user("user_muted"), naga.id).canReview).toBe(false);
    await expect(createReview(user("user_applicant"), { orderItemId: DELIVERED_ITEM, rating: 5 })).rejects.toBeInstanceOf(NotFoundError);
    const dispatchedItem = readStore().orderItems.find((i) => i.sellerOrderId === DISPATCHED)!;
    await expect(createReview(user("user_customer"), { orderItemId: dispatchedItem.id, rating: 5 })).rejects.toBeInstanceOf(ConflictError);
  });

  it("FR-6 confirming delivery unlocks the review", async () => {
    const mayura = getPublicProduct("mayura-raksha-wall-mask")!;
    expect(reviewEligibility(user("user_customer"), mayura.id).canReview).toBe(false);
    await confirmDelivery(user("user_customer"), DISPATCHED);
    expect(reviewEligibility(user("user_customer"), mayura.id)).toMatchObject({ canReview: true });
  });

  it("RULE-R1 allows one review per bought item", async () => {
    const review = await createReview(user("user_customer"), reviewSchema.parse({ orderItemId: DELIVERED_ITEM, rating: "4", comment: "Strong knots and soft cord." }));
    expect(review.orderItemId).toBe(DELIVERED_ITEM);
    await expect(createReview(user("user_customer"), { orderItemId: DELIVERED_ITEM, rating: 5 })).rejects.toBeInstanceOf(ConflictError);
  });

  it("RULE-R3 a seller can't review their own items, and replies once (editable)", async () => {
    const naga = getPublicProduct("naga-raksha-mask")!;
    expect(reviewEligibility(user("user_seller"), naga.id)).toMatchObject({ canReview: false, reason: expect.stringMatching(/own shop/) });
    const review = readStore().reviews.find((r) => r.productId === naga.id)!;
    await replyToReview(user("user_seller"), review.id, "Thank you for the kind words!");
    await replyToReview(user("user_seller"), review.id, "Thank you, Anushka!");
    expect(readStore().reviews.find((r) => r.id === review.id)!.sellerReply).toBe("Thank you, Anushka!");
    const other = readStore().reviews.find((r) => r.shopId !== "shop_ambalangoda-mask-house")!;
    await expect(replyToReview(user("user_seller"), other.id, "Not my review")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("RULE-R2 edits are marked and allowed for 30 days only", async () => {
    const review = await createReview(user("user_customer"), { orderItemId: DELIVERED_ITEM, rating: 3 });
    const edited = await editReview(user("user_customer"), { reviewId: review.id, rating: 5, comment: "Better than I first thought." });
    expect(edited.editedAt).toBeDefined();
    const later = new Date(Date.now() + 31 * 86_400_000);
    await expect(editReview(user("user_customer"), { reviewId: review.id, rating: 4, comment: undefined }, later)).rejects.toBeInstanceOf(ConflictError);
  });

  it("RULE-Q4 reviews can't carry contact details", () => {
    expect(reviewSchema.safeParse({ orderItemId: DELIVERED_ITEM, rating: 5, comment: "Call me on 077 123 4567 for more" }).success).toBe(false);
  });

  it("RULE-M3 a muted customer can't post a review", async () => {
    await transaction((db) => {
      const muted = db.users.find((u) => u.id === "user_customer")!;
      Object.assign(muted, { postingRestriction: "MUTED", mutedUntil: new Date(Date.now() + 86_400_000).toISOString() });
    });
    await expect(createReview(user("user_customer"), { orderItemId: DELIVERED_ITEM, rating: 5 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
