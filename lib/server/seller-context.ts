import "server-only";
import { notFound } from "next/navigation";
import { requireRole } from "./auth";
import { db } from "./db/tx";
import { findShopByOwner, productsOfShopSlug } from "./repositories/catalogue";
import { customRequestsOfShop, sellerOrdersOfShop } from "./repositories/commerce";
import { listAnswers, questionsOfShop, reviewsOfShop } from "./repositories/content";

/** For seller pages: the signed-in seller and their own shop, loaded by owner (RULE-S1). */
export async function sellerContext(path: string) {
  const user = await requireRole(["SELLER"], path);
  const shop = await findShopByOwner(db, user.id);
  if (!shop) notFound();
  return { user, shop, db };
}

export async function sellerCounts(shopId: string, shopSlug: string) {
  const answered = new Set((await listAnswers(db)).filter((a) => a.status !== "DELETED").map((a) => a.questionId));
  return {
    newOrders: (await sellerOrdersOfShop(db, shopId)).filter((so) => so.status === "NEW").length,
    unanswered: (await questionsOfShop(db, shopId)).filter((q) => q.status === "VISIBLE" && !answered.has(q.id)).length,
    pendingItems: (await productsOfShopSlug(db, shopSlug)).filter((p) => p.status === "PENDING_REVIEW").length,
    unrepliedReviews: (await reviewsOfShop(db, shopId)).filter((r) => r.status === "VISIBLE" && !r.sellerReply).length,
    openRequests: (await customRequestsOfShop(db, shopId)).filter((r) => r.status === "OPEN").length,
  };
}
