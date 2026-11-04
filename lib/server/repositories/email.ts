import "server-only";
import { Prisma } from "../db/generated/client";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// B10: email deliveries (backend plan 11.2, 10.2 email.send). The only code that touches email_deliveries (BE-01).
// A row is added once per dedupe key, and every status move is a conditional update from QUEUED (DB-06, JOB-03).

export type EmailStatus = "QUEUED" | "SENT" | "FAILED" | "SKIPPED";

export interface EmailDeliveryRow {
  id: string;
  template: string;
  userId: string;
  toAddress: string | null;
  data: unknown;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

/** What admins see: no address and no data (OPS-01, PDPA). */
export interface EmailProblem {
  id: string;
  template: string;
  userId: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
}

const problemFields = {
  id: true,
  template: true,
  userId: true,
  status: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  lastAttemptAt: true,
} as const;

/** Adds the row unless one with this dedupe key exists (ON CONFLICT DO NOTHING). True when it was added. */
export async function insertEmailDelivery(
  tx: Tx,
  row: { id: string; dedupeKey: string; template: string; userId: string; toAddress?: string; data: object },
): Promise<boolean> {
  const { count } = await writableClientOf(tx).emailDelivery.createMany({
    data: [{ ...row, data: row.data as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  return count === 1;
}

export async function findEmailDelivery(tx: Tx, id: string): Promise<EmailDeliveryRow | undefined> {
  const row = await clientOf(tx).emailDelivery.findUnique({
    where: { id },
    select: {
      id: true,
      template: true,
      userId: true,
      toAddress: true,
      data: true,
      status: true,
      attempts: true,
      lastError: true,
      createdAt: true,
    },
  });
  return row ?? undefined;
}

/** A try that will be retried: counted, with its error code. */
export async function recordEmailAttempt(tx: Tx, id: string, code: string, now: Date): Promise<void> {
  await writableClientOf(tx).emailDelivery.updateMany({
    where: { id, status: "QUEUED" },
    data: { attempts: { increment: 1 }, lastError: code, lastAttemptAt: now },
  });
}

/** Sent: records the provider's id and clears the address and data. False if another run got there first. */
export async function markEmailSent(
  tx: Tx,
  id: string,
  sent: { provider: string; providerMessageId: string },
  now: Date,
): Promise<boolean> {
  const { count } = await writableClientOf(tx).emailDelivery.updateMany({
    where: { id, status: "QUEUED" },
    data: {
      status: "SENT",
      ...sent,
      sentAt: now,
      lastAttemptAt: now,
      attempts: { increment: 1 },
      lastError: null,
      toAddress: null,
      data: Prisma.DbNull,
    },
  });
  return count === 1;
}

/** FAILED (the provider refused it, or it can't be built) or SKIPPED (nobody to send to). */
export async function markEmailFinal(
  tx: Tx,
  id: string,
  outcome: { status: "FAILED" | "SKIPPED"; code: string; attempted: boolean },
  now: Date,
): Promise<boolean> {
  const { count } = await writableClientOf(tx).emailDelivery.updateMany({
    where: { id, status: "QUEUED" },
    data: {
      status: outcome.status,
      lastError: outcome.code,
      ...(outcome.attempted ? { attempts: { increment: 1 }, lastAttemptAt: now } : {}),
      toAddress: null,
      data: Prisma.DbNull,
    },
  });
  return count === 1;
}

/** /admin/emails: failed emails since `failedSince`, and emails still queued since before `queuedBefore`. */
export async function emailProblems(
  tx: Tx,
  { failedSince, queuedBefore, limit }: { failedSince: Date; queuedBefore: Date; limit: number },
): Promise<EmailProblem[]> {
  return clientOf(tx).emailDelivery.findMany({
    where: {
      OR: [
        { status: "FAILED", createdAt: { gte: failedSince } },
        { status: "QUEUED", createdAt: { lt: queuedBefore } },
      ],
    },
    select: problemFields,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

/** email.watch: problems nobody has been told about yet (each alerts once). */
export async function unalertedEmailProblems(tx: Tx, queuedBefore: Date, limit: number): Promise<string[]> {
  const rows = await clientOf(tx).emailDelivery.findMany({
    where: {
      alertedAt: null,
      OR: [{ status: "FAILED" }, { status: "QUEUED", createdAt: { lt: queuedBefore } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}

export async function markEmailsAlerted(tx: Tx, ids: string[], now: Date): Promise<void> {
  if (!ids.length) return;
  await writableClientOf(tx).emailDelivery.updateMany({ where: { id: { in: ids } }, data: { alertedAt: now } });
}

/** An admin sent a stuck email again: a new failure may alert again. */
export async function clearEmailAlert(tx: Tx, id: string): Promise<boolean> {
  const { count } = await writableClientOf(tx).emailDelivery.updateMany({
    where: { id, status: "QUEUED" },
    data: { alertedAt: null },
  });
  return count === 1;
}

/** How many emails have waited since before `queuedBefore` (worker health). */
export async function countWaitingEmails(tx: Tx, queuedBefore: Date): Promise<number> {
  return clientOf(tx).emailDelivery.count({ where: { status: "QUEUED", createdAt: { lt: queuedBefore } } });
}

/** maintenance.cleanup: final rows older than `before` (they hold only the template, key and provider id). */
export async function deleteOldEmailDeliveries(tx: Tx, before: Date, limit: number): Promise<number> {
  const rows = await clientOf(tx).emailDelivery.findMany({
    where: { status: { not: "QUEUED" }, createdAt: { lt: before } },
    select: { id: true },
    take: limit,
  });
  if (!rows.length) return 0;
  const { count } = await writableClientOf(tx).emailDelivery.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  return count;
}
