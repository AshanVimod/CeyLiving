// @vitest-environment node
import { describe, expect, it } from "vitest";
import { productInput, validApplication, validShop } from "@/test/fixtures";
import { withTestStore, user } from "@/test/store-helpers";
import { getPublicProduct, getPublicShop } from "./catalogue";
import { findShopByOwner } from "./repositories/catalogue";
import { decideApplication, submitApplication } from "./services/applications";
import { moderateContent, reportContent } from "./services/moderation";
import { confirmDelivery, transitionSellerOrder } from "./services/orders";
import { decideProduct, saveProduct } from "./services/products";
import { answerQuestion, askQuestion } from "./services/questions";
import { createReview, reviewEligibility } from "./services/reviews";
import { savePayoutDetails, updateShop } from "./services/shops";
import { readStore, transaction } from "./store/dev-store";
import { SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";

withTestStore();

/** Stands in for checkout until real payments exist (spec T10): one paid order for one item. */
async function demoPurchase(customerId: string, productId: string) {
  return transaction((db) => {
    const product = db.products.find((p) => p.id === productId)!;
    const shop = db.shops.find((s) => s.slug === product.shopSlug)!;
    const variant = product.variants[0]!;
    const n = String(900 + db.orders.length);
    db.orders.push({
      id: `order_j${n}`,
      orderNumber: `CM-2026-J${n}`,
      customerId,
      shippingAddress: { recipientName: "Journey Buyer", line1: "1 Lake Road", city: "Kandy", district: "Kandy", phone: "0771234567" },
      subtotalCents: variant.priceCents,
      shippingCents: SHIPPING_FEE_PER_SHOP_CENTS,
      totalCents: variant.priceCents + SHIPPING_FEE_PER_SHOP_CENTS,
      placedAt: new Date().toISOString(),
    });
    db.sellerOrders.push({ id: `so_j${n}`, orderId: `order_j${n}`, shopId: shop.id, status: "NEW", subtotalCents: variant.priceCents, shippingCents: SHIPPING_FEE_PER_SHOP_CENTS, updatedAt: new Date().toISOString() });
    db.orderItems.push({ id: `item_j${n}`, sellerOrderId: `so_j${n}`, productId, variantSku: variant.sku, productTitle: product.title, variantLabel: variant.label, unitPriceCents: variant.priceCents, quantity: 1 });
    return { sellerOrderId: `so_j${n}`, orderItemId: `item_j${n}` };
  });
}

describe("C13 full journey", () => {
  it("apply → approve → set up → post → approve item → buy → deliver → review → ask → answer → report → hide", async () => {
    const admin = user("user_admin");

    // A customer applies and an admin approves: role SELLER, shop DRAFT.
    await submitApplication(user("user_customer"), validApplication());
    const application = readStore().applications.find((a) => a.userId === "user_customer")!;
    await decideApplication(admin, { decision: "approve", applicationId: application.id });
    const seller = user("user_customer");
    expect(seller.role).toBe("SELLER");

    // The new seller sets up the shop and posts an item; it waits for approval (RULE-P2).
    await updateShop(seller, validShop({ name: "Kelani Clay Studio", slug: "kelani-clay-studio" }));
    const item = await saveProduct(seller, productInput({ title: "Kelani clay planter" }), "submit");
    expect(item.status).toBe("PENDING_REVIEW");
    await savePayoutDetails(seller, { bankName: "Sampath Bank", accountNumber: "1029384756" });
    expect(findShopByOwner(seller.id)!.status).toBe("ACTIVE");
    expect(getPublicProduct(item.slug)).toBeUndefined();

    // The admin approves the item: it is now public.
    await decideProduct(admin, { decision: "approve", productId: item.id });
    expect(getPublicShop("kelani-clay-studio")).toBeDefined();
    expect(getPublicProduct(item.slug)).toBeDefined();

    // Another customer buys it; the seller accepts and dispatches; the buyer confirms delivery.
    const buyer = user("user_muted");
    const { sellerOrderId, orderItemId } = await demoPurchase(buyer.id, item.id);
    await transitionSellerOrder(seller, { sellerOrderId, to: "ACCEPTED" });
    await transitionSellerOrder(seller, { sellerOrderId, to: "DISPATCHED", courierName: "Pronto Lanka", trackingRef: undefined });
    expect(reviewEligibility(buyer, item.id).canReview).toBe(false);
    await confirmDelivery(buyer, sellerOrderId);
    expect(reviewEligibility(buyer, item.id)).toMatchObject({ canReview: true });

    // The buyer is muted, so the admin lifts it first; then the review goes through.
    await transaction((db) => Object.assign(db.users.find((u) => u.id === buyer.id)!, { postingRestriction: "NONE", mutedUntil: undefined }));
    await createReview(user("user_muted"), { orderItemId, rating: 5, comment: "Beautiful planter, perfectly packed." });

    // A third customer asks; the seller answers; someone reports the answer; the admin hides it.
    const question = await askQuestion(user("user_applicant"), { productId: item.id, body: "Does it have a drainage hole?" });
    const answer = await answerQuestion(seller, { questionId: question.id, body: "Yes, one hole with a cork stopper." });
    await reportContent(user("user_applicant"), { targetType: "ANSWER", targetId: answer.id, reason: "Something else" });
    await moderateContent(admin, { targetType: "ANSWER", targetId: answer.id, action: "hide", reason: "Testing the moderation flow." });

    const db = readStore();
    expect(db.answers.find((a) => a.id === answer.id)!.status).toBe("HIDDEN");
    expect(db.reviews.some((r) => r.orderItemId === orderItemId && r.status === "VISIBLE")).toBe(true);
    expect(db.auditLog.map((a) => a.action)).toEqual(expect.arrayContaining(["application.approved", "product.approve", "content.hide"]));
    expect(db.notifications.some((n) => n.userId === "user_applicant" && n.type === "question.answered")).toBe(true);
  });
});
