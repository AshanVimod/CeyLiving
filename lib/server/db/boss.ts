import "server-only";
import { PgBoss } from "pg-boss";
import { getEnv } from "@/lib/env";
import { JOB_SCHEMA } from "../jobs/queues";

// JOB-02: the web app's handle on the job queue. It only sends jobs (no workers, no schedules, no maintenance:
// those run in the worker process) and never changes the queue's schema (`npm run jobs:migrate` does, DB-10).
// Only lib/server/repositories/jobs.ts uses it.

const shared = globalThis as unknown as { ceylivingBoss?: Promise<PgBoss> };

/** Options for a pg-boss instance that sends jobs and does nothing else. */
export function producerOptions(connectionString: string) {
  return {
    connectionString,
    schema: JOB_SCHEMA,
    max: 2,
    application_name: "ceyliving-web-jobs",
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
  } as const;
}

/** Started on first use; one per server process, kept on globalThis so dev reloads don't open a new pool each time. */
export function jobProducer(): Promise<PgBoss> {
  if (shared.ceylivingBoss) return shared.ceylivingBoss;
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: see .env.example (DB-10: connect as ceyliving_app).");
  const boss = new PgBoss(producerOptions(url));
  // Connection errors surface on the send that hit them; this only stops an unhandled 'error' event crashing the app.
  boss.on("error", () => undefined);
  const started = boss.start().catch((error: unknown) => {
    shared.ceylivingBoss = undefined;
    throw error;
  });
  return (shared.ceylivingBoss = started);
}

/** Closes the producer's pool; the next send opens a new one (from DATABASE_URL as it is then). Used by tests. */
export async function stopJobProducer(): Promise<void> {
  const started = shared.ceylivingBoss;
  shared.ceylivingBoss = undefined;
  await (await started?.catch(() => undefined))?.stop({ graceful: false, close: true });
}
