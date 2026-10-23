import "server-only";
import type { Address, AuditLogEntry, Notification, SellerApplication, User } from "@/lib/types";
import { readStore, type StoreData } from "../store/dev-store";

// Users, applications, addresses, notifications and the audit log.

export function findUserById(id: string, db: StoreData = readStore()): User | undefined {
  return db.users.find((u) => u.id === id);
}

export function listUsers(db: StoreData = readStore()): User[] {
  return db.users;
}

export function updateUser(db: StoreData, id: string, patch: Partial<User>): User {
  const user = db.users.find((u) => u.id === id);
  if (!user) throw new Error(`User ${id} missing`);
  Object.assign(user, patch);
  return user;
}

export function applicationsOf(userId: string, db: StoreData = readStore()): SellerApplication[] {
  return db.applications.filter((a) => a.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findApplicationById(id: string, db: StoreData = readStore()): SellerApplication | undefined {
  return db.applications.find((a) => a.id === id);
}

export function listApplications(db: StoreData = readStore()): SellerApplication[] {
  return [...db.applications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addressesOf(userId: string, db: StoreData = readStore()): Address[] {
  return db.addresses.filter((a) => a.userId === userId);
}

export function notificationsOf(userId: string, db: StoreData = readStore()): Notification[] {
  return db.notifications.filter((n) => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addNotification(db: StoreData, userId: string, type: string, title: string, href: string): void {
  db.notifications.push({ id: newId("notif"), userId, type, title, href, createdAt: new Date().toISOString() });
}

/** Append-only (SEC-A9): there is no update or delete for audit rows. */
export function addAuditEntry(db: StoreData, entry: Omit<AuditLogEntry, "id" | "createdAt">): void {
  db.auditLog.push({ ...entry, id: newId("audit"), createdAt: new Date().toISOString() });
}

export function listAuditLog(db: StoreData = readStore()): AuditLogEntry[] {
  return [...db.auditLog].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function adminIds(db: StoreData): string[] {
  return db.users.filter((u) => u.role === "ADMIN").map((u) => u.id);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
