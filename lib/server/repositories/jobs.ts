import "server-only";
import { jobProducer } from "../db/boss";
import { writableClientOf, type Tx } from "../db/tx";
import { JOBS, type JobName, type JobPayload } from "../jobs/queues";

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
