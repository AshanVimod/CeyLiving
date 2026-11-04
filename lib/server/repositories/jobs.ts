import "server-only";
import { jobProducer } from "../db/boss";
import { clientOf, writableClientOf, type Tx } from "../db/tx";
import { JOB_SCHEMA, JOBS, type JobName, type JobPayload } from "../jobs/queues";

// JOB-02: background jobs are created inside the business transaction, through the same connection, so a job
// exists only if the change that needs it was committed. The outbox is pg-boss's own job table.

export interface EnqueueOptions {
  /** At most one queued job per key (pg-boss singletonKey), e.g. one auto-hide check per reported post. */
  singletonKey?: string;
  /** Run no earlier than this (for example an unpaid order's expiry time, B07). */
  startAfter?: Date;
}

/** Adds a job to `name`'s queue as part of `tx`; returns the job id, or undefined when a singleton was already queued. */
export async function enqueue<N extends JobName>(
  tx: Tx,
  name: N,
  payload: JobPayload<N>,
  options: EnqueueOptions = {},
): Promise<string | undefined> {
  const data = JOBS[name].payload.parse(payload) as object;
  const client = writableClientOf(tx);
  const boss = await jobProducer();
  const id = await boss.send(name, data, {
    ...options,
    db: {
      // pg-boss writes the job row with this statement, on the transaction's connection.
      executeSql: async (text, values = []) => ({ rows: await client.$queryRawUnsafe<unknown[]>(text, ...values) }),
    },
  });
  return id ?? undefined;
}

/**
 * B10 (worker health): when a worker last showed it was alive. pg-boss stamps `version.cron_on` about every 30
 * seconds while any worker runs its schedules. Undefined when no worker has ever run.
 */
export async function workerLastSeen(tx: Tx): Promise<Date | undefined> {
  const rows = await clientOf(tx).$queryRawUnsafe<{ cron_on: Date | null }[]>(
    `SELECT cron_on FROM ${JOB_SCHEMA}.version LIMIT 1`,
  );
  return rows[0]?.cron_on ?? undefined;
}

/** B10: which of these deliveries still have an email.send job waiting, retrying or running (one query). */
export async function deliveriesWithPendingJobs(tx: Tx, deliveryIds: string[]): Promise<Set<string>> {
  if (!deliveryIds.length) return new Set();
  const rows = await clientOf(tx).$queryRawUnsafe<{ id: string }[]>(
    `SELECT DISTINCT data->>'deliveryId' AS id FROM ${JOB_SCHEMA}.job
      WHERE name = 'email.send' AND state IN ('created', 'retry', 'active') AND data->>'deliveryId' = ANY($1::text[])`,
    deliveryIds,
  );
  return new Set(rows.map((r) => r.id));
}
