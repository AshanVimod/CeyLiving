import "server-only";
import type { Address, AuditLogEntry, Notification, RateEvent, SellerApplication, User } from "@/lib/types";
import { Prisma } from "../db/generated/client";
import {
  applicationColumns,
  clearing,
  toAddress,
  toApplication,
  toAuditEntry,
  toDate,
  toNotification,
  toUser,
} from "../db/mappers";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// Users, applications, addresses, notifications, the audit log and rate events.
// Repositories are the only code that touches stored rows (BE-01); every function takes a handle (`db` or a `tx`).

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

const newestFirst = [{ createdAt: "desc" }, { id: "desc" }] as const;

/** Prisma's "record not found" on update. */
const isMissing = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

const json = (value: unknown) =>
  value === undefined ? undefined : value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

// ---------- Users ----------

export async function findUserById(tx: Tx, id: string): Promise<User | undefined> {
  const row = await clientOf(tx).user.findUnique({ where: { id } });
  return row ? toUser(row) : undefined;
}

export async function listUsers(tx: Tx): Promise<User[]> {
  const rows = await clientOf(tx).user.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(toUser);
}

export async function listAdminIds(tx: Tx): Promise<string[]> {
  const rows = await clientOf(tx).user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function updateUser(tx: Tx, id: string, patch: Partial<User>): Promise<User> {
  const { mutedUntil, createdAt, deletedAt, ...rest } = patch;
  const data = clearing({
    ...rest,
    ...("mutedUntil" in patch && { mutedUntil: toDate(mutedUntil) }),
    ...("createdAt" in patch && { createdAt: toDate(createdAt) }),
    ...("deletedAt" in patch && { deletedAt: toDate(deletedAt) }),
  }) as Prisma.UserUncheckedUpdateInput;
  try {
    return toUser(await writableClientOf(tx).user.update({ where: { id }, data }));
  } catch (error) {
    if (isMissing(error)) throw new Error(`User ${id} missing`);
    throw error;
  }
}

// ---------- Seller applications ----------

export async function applicationsOf(tx: Tx, userId: string): Promise<SellerApplication[]> {
  const rows = await clientOf(tx).sellerApplication.findMany({ where: { userId }, orderBy: [...newestFirst] });
  return rows.map(toApplication);
}

export async function findApplicationById(tx: Tx, id: string): Promise<SellerApplication | undefined> {
  const row = await clientOf(tx).sellerApplication.findUnique({ where: { id } });
  return row ? toApplication(row) : undefined;
}

export async function listApplications(tx: Tx): Promise<SellerApplication[]> {
  const rows = await clientOf(tx).sellerApplication.findMany({ orderBy: [...newestFirst] });
  return rows.map(toApplication);
}

export async function insertApplication(tx: Tx, application: SellerApplication): Promise<SellerApplication> {
  const data = applicationColumns(application) as Prisma.SellerApplicationUncheckedCreateInput;
  return toApplication(await writableClientOf(tx).sellerApplication.create({ data }));
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updateApplication(
  tx: Tx,
  id: string,
  patch: Partial<SellerApplication>,
  guard: { from?: SellerApplication["status"] } = {},
): Promise<SellerApplication | undefined> {
  const client = writableClientOf(tx);
  const data = clearing(applicationColumns(patch)) as Prisma.SellerApplicationUncheckedUpdateManyInput;
  const { count } = await client.sellerApplication.updateMany({
    where: { id, ...(guard.from && { status: guard.from }) },
    data,
  });
  if (count === 0) return undefined;
  return findApplicationById(tx, id);
}

// ---------- Addresses ----------

export async function addressesOf(tx: Tx, userId: string): Promise<Address[]> {
  const rows = await clientOf(tx).address.findMany({ where: { userId }, orderBy: { id: "asc" } });
  return rows.map(toAddress);
}

export async function insertAddress(tx: Tx, address: Address): Promise<Address> {
  return toAddress(await writableClientOf(tx).address.create({ data: address }));
}

/** Deletes one of the user's own addresses; false when it isn't theirs or doesn't exist. */
export async function deleteAddress(tx: Tx, id: string, userId: string): Promise<boolean> {
  const { count } = await writableClientOf(tx).address.deleteMany({ where: { id, userId } });
  return count > 0;
}

export async function deleteAddressesOf(tx: Tx, userId: string): Promise<void> {
  await writableClientOf(tx).address.deleteMany({ where: { userId } });
}

// ---------- Notifications ----------

export async function notificationsOf(tx: Tx, userId: string): Promise<Notification[]> {
  const rows = await clientOf(tx).notification.findMany({ where: { userId }, orderBy: [...newestFirst] });
  return rows.map(toNotification);
}

export async function addNotification(
  tx: Tx,
  userId: string,
  type: string,
  title: string,
  href: string,
): Promise<void> {
  await writableClientOf(tx).notification.create({
    data: { id: newId("notif"), userId, type, title, href, createdAt: new Date() },
  });
}

/** RULE-N1: marks only the user's own unread notifications (all of them, or just `ids`). */
export async function markNotificationsRead(tx: Tx, userId: string, at: string, ids?: string[]): Promise<void> {
  await writableClientOf(tx).notification.updateMany({
    where: { userId, readAt: null, ...(ids && { id: { in: ids } }) },
    data: { readAt: new Date(at) },
  });
}

export async function deleteNotificationsOf(tx: Tx, userId: string): Promise<void> {
  await writableClientOf(tx).notification.deleteMany({ where: { userId } });
}

// ---------- Audit log ----------

/** Append-only (SEC-A9, DB-09): there is no update or delete for audit rows, and the app role may not run one. */
export async function addAuditEntry(tx: Tx, entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<void> {
  await writableClientOf(tx).auditLogEntry.create({
    data: {
      id: newId("audit"),
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason,
      before: json(entry.before),
      after: json(entry.after),
      createdAt: new Date(),
    },
  });
}

export async function listAuditLog(tx: Tx): Promise<AuditLogEntry[]> {
  const rows = await clientOf(tx).auditLogEntry.findMany({ orderBy: [...newestFirst] });
  return rows.map(toAuditEntry);
}

// ---------- Rate events (SEC-A6) ----------

export async function countRateEvents(tx: Tx, userId: string, kind: string, sinceMs: number): Promise<number> {
  return clientOf(tx).rateEvent.count({ where: { userId, kind, at: { gte: new Date(sinceMs) } } });
}

export async function insertRateEvent(tx: Tx, event: RateEvent): Promise<void> {
  await writableClientOf(tx).rateEvent.create({
    data: { userId: event.userId, kind: event.kind, at: new Date(event.at) },
  });
}

/** Drops events older than `beforeMs`; they can no longer count towards any limit. */
export async function pruneRateEvents(tx: Tx, beforeMs: number): Promise<void> {
  await writableClientOf(tx).rateEvent.deleteMany({ where: { at: { lt: new Date(beforeMs) } } });
}

export async function deleteRateEventsOf(tx: Tx, userId: string): Promise<void> {
  await writableClientOf(tx).rateEvent.deleteMany({ where: { userId } });
}
