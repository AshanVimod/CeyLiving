import "server-only";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// B12: monitoring data (backend plan OPS-05 to OPS-07, A09). The only code that touches ops_event_counts, ops_alerts,
// ops_checkpoints and the app's read-only view of _prisma_migrations (BE-01). None of it holds a person, an IP or an
// id: only kinds, times and counts.

/** OPS-05: one round trip, to prove the database answers. */
export async function pingDatabase(tx: Tx): Promise<void> {
  await clientOf(tx).$queryRaw`SELECT 1`;
}

export type MigrationState = "applied" | "missing" | "unfinished" | "rolled_back";

/** OPS-05: whether this build's expected migration is in the database and finished (ceyliving_app may read 3 columns). */
export async function migrationState(tx: Tx, name: string): Promise<MigrationState> {
  const rows = await clientOf(tx).$queryRaw<{ finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = ${name}`;
  // A rolled-back attempt leaves its own row; any one finished, not-rolled-back row means it is applied.
  if (rows.some((r) => r.finished_at && !r.rolled_back_at)) return "applied";
  if (rows.length === 0) return "missing";
  return rows.some((r) => r.rolled_back_at) ? "rolled_back" : "unfinished";
}

/** A09: one more event of `kind` in the bucket starting at `bucketStart`. Atomic, so concurrent events all count. */
export async function incrementEventCount(tx: Tx, kind: string, bucketStart: Date): Promise<void> {
  await writableClientOf(tx).$executeRaw`
    INSERT INTO ops_event_counts (kind, bucket_start, count) VALUES (${kind}, ${bucketStart}, 1)
    ON CONFLICT (kind, bucket_start) DO UPDATE SET count = ops_event_counts.count + 1`;
}

/** Events per kind in buckets starting at or after `since`. Reads the primary key's range (bucket index). */
export async function eventCountsSince(tx: Tx, since: Date): Promise<Map<string, number>> {
  const rows = await clientOf(tx).opsEventCount.groupBy({
    by: ["kind"],
    where: { bucketStart: { gte: since } },
    _sum: { count: true },
  });
  return new Map(rows.map((r) => [r.kind, r._sum.count ?? 0]));
}

/** JOB-06: deletes up to `limit` buckets older than `before`; returns how many. */
export async function deleteEventCountsBefore(tx: Tx, before: Date, limit: number): Promise<number> {
  return writableClientOf(tx).$executeRaw`
    DELETE FROM ops_event_counts WHERE (kind, bucket_start) IN (
      SELECT kind, bucket_start FROM ops_event_counts WHERE bucket_start < ${before} LIMIT ${limit})`;
}

export interface AlertRow {
  kind: string;
  lastSentAt: Date;
  lastCount: number;
}

export async function findAlert(tx: Tx, kind: string): Promise<AlertRow | undefined> {
  return (await clientOf(tx).opsAlert.findUnique({ where: { kind } })) ?? undefined;
}

/** OPS-07: the most recent alert of any kind. */
export async function latestAlert(tx: Tx): Promise<AlertRow | undefined> {
  return (await clientOf(tx).opsAlert.findFirst({ orderBy: { lastSentAt: "desc" } })) ?? undefined;
}

/**
 * OPS-06: claims the right to send an alert of `kind` now. One statement, so two watchers running at once can't both
 * win (JOB-03). It succeeds when no alert of this kind was sent since `quietSince`, or when `count` has reached
 * `escalateAt` times the count the last alert reported (the problem got much worse).
 */
export async function claimAlert(
  tx: Tx,
  claim: { kind: string; count: number; now: Date; quietSince: Date; escalateAt: number },
): Promise<boolean> {
  const { kind, count, now, quietSince, escalateAt } = claim;
  const rows = await writableClientOf(tx).$queryRaw<{ kind: string }[]>`
    INSERT INTO ops_alerts (kind, last_sent_at, last_count) VALUES (${kind}, ${now}, ${count})
    ON CONFLICT (kind) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at, last_count = EXCLUDED.last_count
      WHERE ops_alerts.last_sent_at <= ${quietSince} OR EXCLUDED.last_count >= ops_alerts.last_count * ${escalateAt}
    RETURNING kind`;
  return rows.length === 1;
}

export interface CheckpointRow {
  name: string;
  lastOkAt: Date | null;
  lastFailedAt: Date | null;
}

export async function findCheckpoint(tx: Tx, name: string): Promise<CheckpointRow | undefined> {
  return (await clientOf(tx).opsCheckpoint.findUnique({ where: { name } })) ?? undefined;
}

/** OPS-07: a recurring task (payouts, the B14 backup) succeeded or failed at `at`. */
export async function upsertCheckpoint(tx: Tx, name: string, outcome: "ok" | "failed", at: Date): Promise<void> {
  const field = outcome === "ok" ? { lastOkAt: at } : { lastFailedAt: at };
  await writableClientOf(tx).opsCheckpoint.upsert({ where: { name }, create: { name, ...field }, update: field });
}

/** OPS-06: connections in use against the server's limit. Both from PostgreSQL's own statistics. */
export async function connectionUse(tx: Tx): Promise<{ used: number; max: number }> {
  const rows = await clientOf(tx).$queryRaw<{ used: bigint; max: string }[]>`
    SELECT (SELECT count(*) FROM pg_stat_activity) AS used, current_setting('max_connections') AS max`;
  return { used: Number(rows[0]!.used), max: Number(rows[0]!.max) };
}

/** OPS-06: this database's size in bytes. */
export async function databaseSizeBytes(tx: Tx): Promise<number> {
  const rows = await clientOf(tx).$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
  return Number(rows[0]!.size);
}
