import "server-only";
import { notFound } from "next/navigation";
import { requireRole } from "./auth";
import { findShopByOwner } from "./repositories/catalogue";
import { readStore } from "./store/dev-store";

/** For seller pages: the signed-in seller and their own shop, loaded by owner (RULE-S1). */
export async function sellerContext(path: string) {
  const user = await requireRole(["SELLER"], path);
  const db = readStore();
  const shop = findShopByOwner(user.id, db);
  if (!shop) notFound();
  return { user, shop, db };
}

export function sellerCounts(shopId: string, shopSlug: string) {
  const db = readStore();
  const answered = new Set(db.answers.filter((a) => a.status !== "DELETED").map((a) => a.questionId));
  return {
    newOrders: db.sellerOrders.filter((so) => so.shopId === shopId && so.status === "NEW").length,
    unanswered: db.questions.filter((q) => q.shopId === shopId && q.status === "VISIBLE" && !answered.has(q.id)).length,
    pendingItems: db.products.filter((p) => p.shopSlug === shopSlug && p.status === "PENDING_REVIEW").length,
    unrepliedReviews: db.reviews.filter((r) => r.shopId === shopId && r.status === "VISIBLE" && !r.sellerReply).length,
    openRequests: db.customRequests.filter((r) => r.shopId === shopId && r.status === "OPEN").length,
  };
}
