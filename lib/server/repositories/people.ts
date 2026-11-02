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

// ---------- Sign-in data (Better Auth tables, B05a) ----------

/** AU-04 / AU-11: ends every session of a user (role change, deleted account); they sign in again. */
export async function deleteSessionsOf(tx: Tx, userId: string): Promise<void> {
  await writableClientOf(tx).session.deleteMany({ where: { userId } });
}

/** Ends one session by its cookie token (AU-03: past the 30-day limit). */
export async function deleteSessionByToken(tx: Tx, token: string): Promise<void> {
  await writableClientOf(tx).session.deleteMany({ where: { token } });
}

/** FR-17 / AU-11: removes how a deleted account signed in (its password hash and sessions). */
export async function deleteSignInDataOf(tx: Tx, userId: string): Promise<void> {
  const client = writableClientOf(tx);
  await client.session.deleteMany({ where: { userId } });
  await client.account.deleteMany({ where: { userId } });
}

/**
 * AU-06: counts one attempt for `key` in a fixed window and returns the count so far. One statement, so attempts
 * from several app instances at once are all counted (the row lives in PostgreSQL, not in a process).
 */
export async function countAuthAttempt(tx: Tx, key: string, windowMs: number, nowMs: number): Promise<number> {
  const rows = await writableClientOf(tx).$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (id, key, count, last_request) VALUES (${newId("rl")}, ${key}, 1, ${nowMs})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.last_request <= ${nowMs - windowMs} THEN 1 ELSE rate_limits.count + 1 END,
      last_request = CASE WHEN rate_limits.last_request <= ${nowMs - windowMs} THEN ${nowMs}
                          ELSE rate_limits.last_request END
    RETURNING count`;
  return rows[0]!.count;
}

/** AU-04: ends every session of a user except the one carrying `keepToken` (two-step set-up). */
export async function deleteOtherSessionsOf(tx: Tx, userId: string, keepToken: string): Promise<void> {
  await writableClientOf(tx).session.deleteMany({ where: { userId, token: { not: keepToken } } });
}

export interface PasskeySummary {
  id: string;
  name?: string;
  createdAt?: string;
}

export interface TwoStepStatus {
  /** An authenticator app is set up and confirmed (AU-02). */
  appEnabled: boolean;
  /** Recovery codes not used yet; only their hashes are stored, so only the count can be shown. */
  recoveryCodesLeft: number;
  /** Whether the account has a password (accounts made before B05a may not). */
  hasPassword: boolean;
  passkeys: PasskeySummary[];
}

/** AU-02: what the security pages show about a person's second steps. */
export async function twoStepStatusOf(tx: Tx, userId: string): Promise<TwoStepStatus> {
  const client = clientOf(tx);
  const [user, app, credential, passkeys] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
    client.twoFactor.findUnique({ where: { userId }, select: { verified: true, backupCodes: true } }),
    client.account.findFirst({ where: { userId, providerId: "credential" }, select: { id: true } }),
    client.passkey.findMany({
      where: { userId },
      select: { id: true, name: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const appEnabled = Boolean(user?.twoFactorEnabled && app?.verified);
  let recoveryCodesLeft = 0;
  if (appEnabled && app) {
    try {
      recoveryCodesLeft = (JSON.parse(app.backupCodes) as unknown[]).length;
    } catch {
      recoveryCodesLeft = 0;
    }
  }
  return {
    appEnabled,
    recoveryCodesLeft,
    hasPassword: Boolean(credential),
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name ?? undefined, createdAt: p.createdAt?.toISOString() })),
  };
}

/**
 * AU-06: the count so far for `key` in its current window, without counting this request (see countAuthAttempt).
 */
export async function peekAuthAttempts(tx: Tx, key: string, windowMs: number, nowMs: number): Promise<number> {
  const row = await clientOf(tx).rateLimit.findUnique({ where: { key }, select: { count: true, lastRequest: true } });
  if (!row || Number(row.lastRequest) <= nowMs - windowMs) return 0;
  return row.count;
}

/** AU-02: whether the account already has a second step (a confirmed authenticator app or a passkey). */
export async function hasSecondStep(tx: Tx, userId: string): Promise<boolean> {
  const client = clientOf(tx);
  const [app, passkey] = await Promise.all([
    client.twoFactor.findFirst({ where: { userId, verified: true }, select: { id: true } }),
    client.passkey.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return Boolean(app || passkey);
}
