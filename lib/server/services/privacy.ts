import "server-only";
import { ConflictError, ForbiddenError } from "../errors";
import type { Actor } from "../permissions";
import { readStore, transaction, type StoreData } from "../store/dev-store";

const FORMER = "Former customer";
const OPEN_ORDER = ["NEW", "ACCEPTED", "IN_PROGRESS", "DISPATCHED"];

/** FR-17 / SEC-12: everything we hold about the signed-in person, and nothing about anyone else. */
export function exportMyData(actor: Actor, db: StoreData = readStore()) {
  const orders = db.orders.filter((o) => o.customerId === actor.id);
  const orderIds = new Set(orders.map((o) => o.id));
  const sellerOrders = db.sellerOrders.filter((so) => orderIds.has(so.orderId));
  const sellerOrderIds = new Set(sellerOrders.map((so) => so.id));
  const user = db.users.find((u) => u.id === actor.id)!;
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      memberSince: user.createdAt,
      postingRestriction: user.postingRestriction,
    },
    addresses: db.addresses
      .filter((a) => a.userId === actor.id)
      .map((a) => ({
        label: a.label,
        recipientName: a.recipientName,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        district: a.district,
        postalCode: a.postalCode,
        phone: a.phone,
      })),
    orders: orders.map((o) => ({
      ...o,
      deliveries: sellerOrders
        .filter((so) => so.orderId === o.id)
        .map((so) => ({
          shop: db.shops.find((s) => s.id === so.shopId)?.name,
          status: so.status,
          courier: so.courierName,
          tracking: so.trackingRef,
        })),
      items: db.orderItems.filter(
        (i) =>
          sellerOrderIds.has(i.sellerOrderId) && sellerOrders.find((so) => so.id === i.sellerOrderId)?.orderId === o.id,
      ),
    })),
    reviews: db.reviews
      .filter((r) => r.authorId === actor.id)
      .map((r) => ({
        id: r.id,
        productId: r.productId,
        rating: r.rating,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
      })),
    questions: db.questions
      .filter((q) => q.authorId === actor.id)
      .map((q) => ({ id: q.id, productId: q.productId, body: q.body, status: q.status, createdAt: q.createdAt })),
    reportsMade: db.reports
      .filter((r) => r.reporterId === actor.id)
      .map((r) => ({ targetType: r.targetType, reason: r.reason, status: r.status, createdAt: r.createdAt })),
    sellerApplications: db.applications.filter((a) => a.userId === actor.id),
    customRequests: db.customRequests.filter((r) => r.customerId === actor.id),
    notifications: db.notifications
      .filter((n) => n.userId === actor.id)
      .map((n) => ({ title: n.title, type: n.type, readAt: n.readAt, createdAt: n.createdAt })),
  };
}

/**
 * FR-17: soft delete with anonymisation. Order records stay (legal and tax), but the name, email, phone,
 * addresses and notifications are removed, and public posts show "Former customer".
 */
export async function deleteMyAccount(actor: Actor, now = new Date()): Promise<void> {
  if (actor.role === "ADMIN") throw new ForbiddenError("Admin accounts can’t be deleted from here. Ask another admin.");
  await transaction((db) => {
    const user = db.users.find((u) => u.id === actor.id);
    if (!user || user.deletedAt) throw new ConflictError("This account is already deleted.");
    const shop = db.shops.find((s) => s.ownerId === user.id && s.status !== "CLOSED");
    if (shop) throw new ConflictError("Close your shop before deleting your account. Contact us to close it.");
    const myOrderIds = new Set(db.orders.filter((o) => o.customerId === user.id).map((o) => o.id));
    if (db.sellerOrders.some((so) => myOrderIds.has(so.orderId) && OPEN_ORDER.includes(so.status))) {
      throw new ConflictError("You have orders on their way. You can delete your account once they’ve been delivered.");
    }
    Object.assign(user, {
      name: FORMER,
      email: `deleted-${user.id}@invalid`,
      phone: undefined,
      deletedAt: now.toISOString(),
      mutedUntil: undefined,
      restrictionReason: undefined,
    });
    db.orders
      .filter((o) => o.customerId === user.id)
      .forEach((o) => (o.shippingAddress = { ...o.shippingAddress, recipientName: FORMER, phone: "" }));
    db.reviews.filter((r) => r.authorId === user.id).forEach((r) => (r.authorName = FORMER));
    db.questions.filter((q) => q.authorId === user.id).forEach((q) => (q.authorName = FORMER));
    db.customRequests.filter((r) => r.customerId === user.id).forEach((r) => (r.customerName = FORMER));
    db.applications
      .filter((a) => a.userId === user.id && (a.status === "PENDING" || a.status === "NEEDS_CHANGES"))
      .forEach((a) => (a.status = "WITHDRAWN"));
    db.addresses = db.addresses.filter((a) => a.userId !== user.id);
    db.notifications = db.notifications.filter((n) => n.userId !== user.id);
    db.helpfulVotes = db.helpfulVotes.filter((v) => v.userId !== user.id);
    db.rateEvents = db.rateEvents.filter((e) => e.userId !== user.id);
  });
}
