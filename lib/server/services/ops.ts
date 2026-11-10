import "server-only";
import { statfs } from "node:fs/promises";
import {
  OPS_ALERT_ESCALATE_FACTOR,
  OPS_ALERT_QUIET_MS,
  OPS_ALERT_RULES,
  OPS_BUCKET_MS,
  OPS_EVENT_KINDS,
  OPS_LIMIT_RULES,
  type OpsEventKind,
} from "@/lib/config";
import { getEnv } from "@/lib/env";
import { db, withTx, type Tx } from "../db/tx";
import { queueEmail } from "../email/queue";
import { logger } from "../observability/logger";
import { assertRole, type Actor } from "../permissions";
import { emailCounts } from "../repositories/email";
import { jobStateCounts, workerLastSeen } from "../repositories/jobs";
import {
  claimAlert,
  connectionUse,
  databaseSizeBytes,
  eventCountsSince,
  findAlert,
  findCheckpoint,
  incrementEventCount,
  latestAlert,
  upsertCheckpoint,
} from "../repositories/ops";
import { addNotifications, listAdminIds } from "../repositories/people";

// B12: security events, alerts and the Operations card (backend plan OPS-06, OPS-07, A09). Everything here is counts,
// kinds and times: no person, IP, address or id ever goes into a counter, an alert or the card.

/** A counter never makes a request slower than this, however slow the database is. */
export const COUNT_EVENT_TIMEOUT_MS = 500;

/**
 * A09: counts one event. Runs in its own short transaction, never the caller's, so a business change that rolls back
 * (a refused payment, a failed reveal) still leaves its event counted. Never throws and never waits more than
 * COUNT_EVENT_TIMEOUT_MS: a failure path must not get worse because of its own counter.
 */
export async function countEvent(kind: OpsEventKind, now = new Date()): Promise<void> {
  const bucket = new Date(Math.floor(now.getTime() / OPS_BUCKET_MS) * OPS_BUCKET_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = withTx((tx) => incrementEventCount(tx, kind, bucket))
    .catch((error: unknown) => {
      logger.warn({ err: error, kind }, "ops.count_failed");
    })
    .finally(() => inFlight.delete(write));
  inFlight.add(write);
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn({ kind }, "ops.count_slow");
      resolve();
    }, COUNT_EVENT_TIMEOUT_MS);
  });
  try {
    await Promise.race([write, giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/** Writes still running after countEvent stopped waiting for them (they finish on their own). */
const inFlight = new Set<Promise<void>>();

/** Tests and shutdown: waits until every counter write already started has finished. */
export async function settleEventCounts(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}

/** Checkpoint names (OPS-07). B14's backup script writes `backup` with recordCheckpoint. */
export type CheckpointName = "payouts" | "backup";

/** OPS-07: a recurring task finished. Its own transaction, after the task's own work has committed. */
export async function recordCheckpoint(name: CheckpointName, outcome: "ok" | "failed", at = new Date()): Promise<void> {
  await withTx((tx) => upsertCheckpoint(tx, name, outcome, at));
}

// ---------- The watcher (ops.watch, every 5 minutes) ----------

export interface Finding {
  kind: string;
  label: string;
  level: "critical" | "normal";
  /** How many times it happened in the rule's window (for live checks: the percentage used). */
  count: number;
  /** Words for the count, e.g. "23 in 15 minutes" or "86% used". */
  measure: string;
}

/** OPS-06: every rule that fires right now. Pure reads; nothing is sent here. */
export async function currentFindings(now = new Date()): Promise<Finding[]> {
  const findings: Finding[] = [];
  const windows = new Map<number, Map<string, number>>();
  for (const kind of OPS_EVENT_KINDS) {
    const rule = OPS_ALERT_RULES[kind];
    if (!windows.has(rule.windowMs)) {
      // A bucket starting inside the window counts; a 5-minute-old partial bucket is near enough.
      windows.set(rule.windowMs, await eventCountsSince(db, new Date(now.getTime() - rule.windowMs)));
    }
    const count = windows.get(rule.windowMs)!.get(kind) ?? 0;
    if (count >= rule.threshold) {
      findings.push({
        kind,
        label: rule.label,
        level: rule.level,
        count,
        measure: `${count} in ${Math.round(rule.windowMs / 60_000)} minutes`,
      });
    }
  }
  findings.push(...(await limitFindings(now)));
  return findings;
}

async function limitFindings(now: Date): Promise<Finding[]> {
  const out: Finding[] = [];
  const percentFinding = (kind: keyof typeof OPS_LIMIT_RULES, used: number, of: number, percent: number) => {
    const share = Math.round((used / of) * 100);
    if (of > 0 && share >= percent) {
      out.push({
        kind,
        label: OPS_LIMIT_RULES[kind].label,
        level: "critical",
        count: share,
        measure: `${share}% used`,
      });
    }
  };
  const connections = await connectionUse(db);
  percentFinding("db_connections", connections.used, connections.max, OPS_LIMIT_RULES.db_connections.percent);
  const sizeLimitMb = getEnv().DATABASE_SIZE_LIMIT_MB;
  if (sizeLimitMb) {
    percentFinding("db_size", await databaseSizeBytes(db), sizeLimitMb * 1024 * 1024, OPS_LIMIT_RULES.db_size.percent);
  }
  try {
    const disk = await statfs("/");
    const total = disk.blocks * disk.bsize;
    percentFinding("disk", total - disk.bavail * disk.bsize, total, OPS_LIMIT_RULES.disk.percent);
  } catch (error) {
    logger.warn({ err: error }, "ops.disk_unreadable");
  }
  // The backup rule stays silent until B14 records a first backup, so it can't nag before backups exist.
  const backup = await findCheckpoint(db, "backup");
  if (backup) {
    const lastOk = backup.lastOkAt?.getTime() ?? 0;
    const failedSince = backup.lastFailedAt && backup.lastFailedAt.getTime() > lastOk;
    const overdue = now.getTime() - lastOk > OPS_LIMIT_RULES.backup.overdueMs;
    if (failedSince || overdue) {
      out.push({
        kind: "backup",
        label: OPS_LIMIT_RULES.backup.label,
        level: "critical",
        count: 1,
        measure: failedSince ? "the last backup failed" : "no successful backup for over 26 hours",
      });
    }
  }
  return out;
}

/**
 * OPS-06: turns findings into alerts. Each one is claimed, notified and (if critical) emailed in one transaction, so
 * a retry or a second worker can't send it twice (JOB-03). A kind alerts at most once an hour while it continues,
 * plus once early whenever it gets OPS_ALERT_ESCALATE_FACTOR times worse than its last alert.
 */
export async function watchOps(now = new Date()): Promise<{ findings: number; alerted: string[] }> {
  const findings = await currentFindings(now);
  const alerted: string[] = [];
  for (const finding of findings) {
    const sent = await withTx(async (tx) => {
      const previous = await findAlert(tx, finding.kind);
      const quietSince = new Date(now.getTime() - OPS_ALERT_QUIET_MS);
      const claimed = await claimAlert(tx, {
        kind: finding.kind,
        count: finding.count,
        now,
        quietSince,
        escalateAt: OPS_ALERT_ESCALATE_FACTOR,
      });
      if (!claimed) return false;
      const worse = Boolean(previous && previous.lastSentAt > quietSince);
      await sendAlert(tx, finding, worse, now);
      return true;
    });
    if (sent) alerted.push(finding.kind);
  }
  if (alerted.length) logger.warn({ kinds: alerted }, "ops.alerted");
  return { findings: findings.length, alerted };
}

async function sendAlert(tx: Tx, finding: Finding, worse: boolean, now: Date): Promise<void> {
  const adminIds = await listAdminIds(tx);
  const title = `${worse ? "Getting worse: " : ""}${finding.label} (${finding.measure}). See Operations on the admin dashboard.`;
  await addNotifications(
    tx,
    adminIds.map((userId) => ({ userId, type: `ops.${finding.level}`, title, href: "/admin" })),
  );
  if (finding.level !== "critical") return;
  for (const userId of adminIds) {
    // The key makes this exact alert one email per admin, however often the job runs (JOB-03). queueEmail never
    // throws: an email that can't be queued is logged and reported to the admins in the app (B10).
    await queueEmail(tx, "ops.alert", {
      userId,
      key: `${finding.kind}:${now.toISOString()}:${userId}`,
      data: { label: finding.label, measure: finding.measure, worse },
    });
  }
}

// ---------- The Operations card (OPS-07) ----------

export interface OperationsOverview {
  workerLastSeen?: Date;
  failedJobs: { total: number; byName: { name: string; count: number }[] };
  queues: { waiting: number; retrying: number; running: number };
  lastPayoutRun?: Date;
  backup: { state: "not_set_up" } | { state: "ok" | "failed"; at: Date };
  emails: { queued: number; failed: number; failedAlerts: number };
  last24h: Record<OpsEventKind, number>;
  lastAlert?: { kind: string; label: string; at: Date };
}

const WEEK_MS = 7 * 86_400_000;

export async function operationsOverview(actor: Actor, now = new Date()): Promise<OperationsOverview> {
  assertRole(actor, ["ADMIN"]);
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const [seen, jobs, payouts, backup, emails, events, alert] = await Promise.all([
    workerLastSeen(db),
    jobStateCounts(db, weekAgo),
    findCheckpoint(db, "payouts"),
    findCheckpoint(db, "backup"),
    emailCounts(db, weekAgo),
    eventCountsSince(db, new Date(now.getTime() - 86_400_000)),
    latestAlert(db),
  ]);
  const failed = jobs.filter((j) => j.state === "failed").sort((a, b) => b.count - a.count);
  const sum = (state: string) => jobs.filter((j) => j.state === state).reduce((n, j) => n + j.count, 0);
  const lastOk = backup?.lastOkAt?.getTime() ?? 0;
  const lastFailed = backup?.lastFailedAt?.getTime() ?? 0;
  return {
    workerLastSeen: seen,
    failedJobs: { total: sum("failed"), byName: failed.map(({ name, count }) => ({ name, count })) },
    queues: { waiting: sum("created"), retrying: sum("retry"), running: sum("active") },
    lastPayoutRun: payouts?.lastOkAt ?? undefined,
    backup: !backup
      ? { state: "not_set_up" }
      : lastFailed > lastOk
        ? { state: "failed", at: backup.lastFailedAt! }
        : { state: "ok", at: backup.lastOkAt! },
    emails,
    last24h: Object.fromEntries(OPS_EVENT_KINDS.map((k) => [k, events.get(k) ?? 0])) as Record<OpsEventKind, number>,
    lastAlert: alert ? { kind: alert.kind, label: alertLabel(alert.kind), at: alert.lastSentAt } : undefined,
  };
}

function alertLabel(kind: string): string {
  if (kind in OPS_ALERT_RULES) return OPS_ALERT_RULES[kind as OpsEventKind].label;
  if (kind in OPS_LIMIT_RULES) return OPS_LIMIT_RULES[kind as keyof typeof OPS_LIMIT_RULES].label;
  return kind;
}
