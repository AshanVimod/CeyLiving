import "server-only";
import type { Address, AuditLogEntry, Notification, RateEvent, SellerApplication, User } from "@/lib/types";
import { out, rowsOf, writableRowsOf, type Tx } from "../db/tx";

// Users, applications, addresses, notifications, the audit log and rate events.
// Repositories are the only code that touches stored rows (BE-01); every function takes a handle (`db` or a `tx`).

const newestFirst = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ---------- Users ----------

export async function findUserById(tx: Tx, id: string): Promise<User | undefined> {
  return out(
    tx,
    rowsOf(tx).users.find((u) => u.id === id),
  );
}

export async function listUsers(tx: Tx): Promise<User[]> {
  return out(tx, rowsOf(tx).users);
}

export async function listAdminIds(tx: Tx): Promise<string[]> {
  return rowsOf(tx)
    .users.filter((u) => u.role === "ADMIN")
    .map((u) => u.id);
}

export async function updateUser(tx: Tx, id: string, patch: Partial<User>): Promise<User> {
  const user = writableRowsOf(tx).users.find((u) => u.id === id);
  if (!user) throw new Error(`User ${id} missing`);
  Object.assign(user, patch);
  return out(tx, user);
}

// ---------- Seller applications ----------

export async function applicationsOf(tx: Tx, userId: string): Promise<SellerApplication[]> {
  return out(
    tx,
    rowsOf(tx)
      .applications.filter((a) => a.userId === userId)
      .sort(newestFirst),
  );
}

export async function findApplicationById(tx: Tx, id: string): Promise<SellerApplication | undefined> {
  return out(
    tx,
    rowsOf(tx).applications.find((a) => a.id === id),
  );
}

export async function listApplications(tx: Tx): Promise<SellerApplication[]> {
  return out(tx, [...rowsOf(tx).applications].sort(newestFirst));
}

export async function insertApplication(tx: Tx, application: SellerApplication): Promise<SellerApplication> {
  writableRowsOf(tx).applications.push(structuredClone(application));
  return out(tx, application);
}

/** DB-06: with `from`, the update only applies while the status is still `from`; returns undefined otherwise. */
export async function updateApplication(
  tx: Tx,
  id: string,
  patch: Partial<SellerApplication>,
  guard: { from?: SellerApplication["status"] } = {},
): Promise<SellerApplication | undefined> {
  const application = writableRowsOf(tx).applications.find((a) => a.id === id);
  if (!application || (guard.from && application.status !== guard.from)) return undefined;
  Object.assign(application, patch);
  return out(tx, application);
}

// ---------- Addresses ----------

export async function addressesOf(tx: Tx, userId: string): Promise<Address[]> {
  return out(
    tx,
    rowsOf(tx).addresses.filter((a) => a.userId === userId),
  );
}

export async function insertAddress(tx: Tx, address: Address): Promise<Address> {
  writableRowsOf(tx).addresses.push(structuredClone(address));
  return out(tx, address);
}

/** Deletes one of the user's own addresses; false when it isn't theirs or doesn't exist. */
export async function deleteAddress(tx: Tx, id: string, userId: string): Promise<boolean> {
  const rows = writableRowsOf(tx);
  const index = rows.addresses.findIndex((a) => a.id === id && a.userId === userId);
  if (index === -1) return false;
  rows.addresses.splice(index, 1);
  return true;
}

export async function deleteAddressesOf(tx: Tx, userId: string): Promise<void> {
  const rows = writableRowsOf(tx);
  rows.addresses = rows.addresses.filter((a) => a.userId !== userId);
}

// ---------- Notifications ----------

export async function notificationsOf(tx: Tx, userId: string): Promise<Notification[]> {
  return out(
    tx,
    rowsOf(tx)
      .notifications.filter((n) => n.userId === userId)
      .sort(newestFirst),
  );
}

export async function addNotification(
  tx: Tx,
  userId: string,
  type: string,
  title: string,
  href: string,
): Promise<void> {
  writableRowsOf(tx).notifications.push({
    id: newId("notif"),
    userId,
    type,
    title,
    href,
    createdAt: new Date().toISOString(),
  });
}

/** RULE-N1: marks only the user's own unread notifications (all of them, or just `ids`). */
export async function markNotificationsRead(tx: Tx, userId: string, at: string, ids?: string[]): Promise<void> {
  writableRowsOf(tx)
    .notifications.filter((n) => n.userId === userId && !n.readAt && (!ids || ids.includes(n.id)))
    .forEach((n) => (n.readAt = at));
}

export async function deleteNotificationsOf(tx: Tx, userId: string): Promise<void> {
  const rows = writableRowsOf(tx);
  rows.notifications = rows.notifications.filter((n) => n.userId !== userId);
}

// ---------- Audit log ----------

/** Append-only (SEC-A9): there is no update or delete for audit rows. */
export async function addAuditEntry(tx: Tx, entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<void> {
  writableRowsOf(tx).auditLog.push({
    ...structuredClone(entry),
    id: newId("audit"),
    createdAt: new Date().toISOString(),
  });
}

export async function listAuditLog(tx: Tx): Promise<AuditLogEntry[]> {
  return out(tx, [...rowsOf(tx).auditLog].sort(newestFirst));
}

// ---------- Rate events (SEC-A6) ----------

export async function countRateEvents(tx: Tx, userId: string, kind: string, sinceMs: number): Promise<number> {
  return rowsOf(tx).rateEvents.filter((e) => e.userId === userId && e.kind === kind && Date.parse(e.at) >= sinceMs)
    .length;
}

export async function insertRateEvent(tx: Tx, event: RateEvent): Promise<void> {
  writableRowsOf(tx).rateEvents.push({ ...event });
}

/** Drops events older than `beforeMs`; they can no longer count towards any limit. */
export async function pruneRateEvents(tx: Tx, beforeMs: number): Promise<void> {
  const rows = writableRowsOf(tx);
  rows.rateEvents = rows.rateEvents.filter((e) => Date.parse(e.at) >= beforeMs);
}

export async function deleteRateEventsOf(tx: Tx, userId: string): Promise<void> {
  const rows = writableRowsOf(tx);
  rows.rateEvents = rows.rateEvents.filter((e) => e.userId !== userId);
}
