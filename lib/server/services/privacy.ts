import "server-only";
import { db, withTx, type Tx } from "../db/tx";
import { ConflictError, ForbiddenError } from "../errors";
import type { Actor } from "../permissions";
import { findShopByOwner, listShops } from "../repositories/catalogue";
import {
  customRequestsOfCustomer,
  itemsOfSellerOrders,
  listOrdersOfCustomer,
  renameCustomerOnRequests,
  sellerOrdersOfCustomer,
  updateOrder,
} from "../repositories/commerce";
import {
  deleteVotesOf,
  questionsByAuthor,
  renameAuthorOnPosts,
  reportsByReporter,
  reviewsByAuthor,
} from "../repositories/content";
import {
  addressesOf,
  applicationsOf,
  deleteAddressesOf,
  deleteNotificationsOf,
  deleteRateEventsOf,
  findUserById,
  notificationsOf,
  updateApplication,
  updateUser,
} from "../repositories/people";

const FORMER = "Former customer";
const OPEN_ORDER = ["NEW", "ACCEPTED", "IN_PROGRESS", "DISPATCHED"];

/** FR-17 / SEC-12: everything we hold about the signed-in person, and nothing about anyone else. */
export async function exportMyData(actor: Actor, tx: Tx = db) {
  const orders = await listOrdersOfCustomer(tx, actor.id);
  const sellerOrders = await sellerOrdersOfCustomer(tx, actor.id);
  const items = await itemsOfSellerOrders(
    tx,
    sellerOrders.map((so) => so.id),
  );
  const shopNames = new Map((await listShops(tx)).map((s) => [s.id, s.name]));
  const user = (await findUserById(tx, actor.id))!;
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
    addresses: (await addressesOf(tx, actor.id)).map((a) => ({
      label: a.label,
      recipientName: a.recipientName,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      district: a.district,
      postalCode: a.postalCode,
      phone: a.phone,
    })),
    orders: orders.map((o) => {
      const mine = sellerOrders.filter((so) => so.orderId === o.id);
      const mineIds = new Set(mine.map((so) => so.id));
      return {
        ...o,
        deliveries: mine.map((so) => ({
          shop: shopNames.get(so.shopId),
          status: so.status,
          courier: so.courierName,
          tracking: so.trackingRef,
        })),
        items: items.filter((i) => mineIds.has(i.sellerOrderId)),
      };
    }),
    reviews: [...(await reviewsByAuthor(tx, actor.id))]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({
        id: r.id,
        productId: r.productId,
        rating: r.rating,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
      })),
    questions: [...(await questionsByAuthor(tx, actor.id))]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((q) => ({ id: q.id, productId: q.productId, body: q.body, status: q.status, createdAt: q.createdAt })),
    reportsMade: (await reportsByReporter(tx, actor.id)).map((r) => ({
      targetType: r.targetType,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    })),
    sellerApplications: await applicationsOf(tx, actor.id),
    customRequests: await customRequestsOfCustomer(tx, actor.id),
    notifications: (await notificationsOf(tx, actor.id)).map((n) => ({
      title: n.title,
      type: n.type,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  };
}

/**
 * FR-17: soft delete with anonymisation. Order records stay (legal and tax), but the name, email, phone,
 * addresses (including shop-application addresses) and notifications are removed, and public posts show
 * "Former customer".
 */
export async function deleteMyAccount(actor: Actor, now = new Date()): Promise<void> {
  if (actor.role === "ADMIN") throw new ForbiddenError("Admin accounts can’t be deleted from here. Ask another admin.");
  await withTx(async (tx) => {
    const user = await findUserById(tx, actor.id);
    if (!user || user.deletedAt) throw new ConflictError("This account is already deleted.");
    if (await findShopByOwner(tx, user.id))
      throw new ConflictError("Close your shop before deleting your account. Contact us to close it.");
    if ((await sellerOrdersOfCustomer(tx, user.id)).some((so) => OPEN_ORDER.includes(so.status))) {
      throw new ConflictError("You have orders on their way. You can delete your account once they’ve been delivered.");
    }
    await updateUser(tx, user.id, {
      name: FORMER,
      email: `deleted-${user.id}@invalid`,
      phone: undefined,
      deletedAt: now.toISOString(),
      mutedUntil: undefined,
      restrictionReason: undefined,
    });
    for (const order of await listOrdersOfCustomer(tx, user.id))
      await updateOrder(tx, order.id, {
        shippingAddress: { ...order.shippingAddress, recipientName: FORMER, phone: "" },
      });
    await renameAuthorOnPosts(tx, user.id, FORMER);
    await renameCustomerOnRequests(tx, user.id, FORMER);
    for (const application of await applicationsOf(tx, user.id)) {
      const open = application.status === "PENDING" || application.status === "NEEDS_CHANGES";
      // The decision stays for the record; the applicant's contact details and address don't.
      await updateApplication(tx, application.id, {
        ...(open ? { status: "WITHDRAWN" as const } : {}),
        applicantName: FORMER,
        phone: "",
        businessRegNo: undefined,
        address: { line1: "", city: "", district: application.address.district },
      });
    }
    await deleteAddressesOf(tx, user.id);
    await deleteNotificationsOf(tx, user.id);
    await deleteVotesOf(tx, user.id);
    await deleteRateEventsOf(tx, user.id);
  });
}
