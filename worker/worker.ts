import type { Logger } from "pino";
import { PgBoss, type ConstructorOptions } from "pg-boss";
import { runJob } from "@/lib/server/observability/job";
import { JOB_NAMES, JOB_SCHEMA, JOBS, SCHEDULE_TIME_ZONE, SCHEDULED_JOBS } from "@/lib/server/jobs/queues";
import { HANDLERS } from "./handlers";

// The background worker (backend plan 3, section 10): one pg-boss instance that runs the catalogue's handlers and
// keeps its schedules. worker/index.ts starts it as a process; tests start several on one database.

/** JOB-07: how long a graceful stop waits for running jobs before giving up on them (they are retried later). */
export const SHUTDOWN_TIMEOUT_MS = 30_000;

export interface WorkerOptions {
  /** The app's database user (DB-10): ceyliving_app. */
  connectionString: string;
  log: Logger;
  /** Jobs of one queue this process runs at the same time. */
  concurrency: number;
  /** Tests only: pg-boss timing overrides (polling, cron checks). */
  boss?: Partial<ConstructorOptions>;
}

export interface RunningWorker {
  boss: PgBoss;
  /** JOB-07: stop taking jobs, wait up to `timeoutMs` for the running ones, close the pool. */
  stop(timeoutMs?: number): Promise<void>;
}

export async function startWorker({ connectionString, log, concurrency, boss: overrides }: WorkerOptions) {
  const boss = new PgBoss({
    connectionString,
    schema: JOB_SCHEMA,
    application_name: "ceyliving-worker",
    instanceName: "worker",
    // `npm run jobs:migrate` owns the schema (DB-10); a worker that finds it missing or old refuses to start.
    migrate: false,
    createSchema: false,
    max: concurrency + 4,
    ...overrides,
  });
  boss.on("error", (error) => log.error({ err: error }, "worker.queue_error"));
  boss.on("warning", (warning) => log.warn({ warning }, "worker.queue_warning"));
  await boss.start();

  for (const name of JOB_NAMES) {
    await boss.work(name, { includeMetadata: true, batchSize: 1, localConcurrency: concurrency }, async ([job]) => {
      await runJob(name, job!, HANDLERS[name], log);
    });
  }

  // JOB-05: pg-boss stores schedules in the database and, on every cron pass, files each tick under one singleton
  // key, so however many workers run, a tick creates one job. schedule() is an upsert: restarts change nothing.
  for (const name of SCHEDULED_JOBS) {
    await boss.schedule(name, (JOBS[name] as { cron: string }).cron, {}, { tz: SCHEDULE_TIME_ZONE });
  }
  // A job dropped from the catalogue stops running on its old timetable.
  for (const schedule of await boss.getSchedules()) {
    if (!(SCHEDULED_JOBS as string[]).includes(schedule.name)) await boss.unschedule(schedule.name, schedule.key);
  }

  log.info({ queues: JOB_NAMES.length, schedules: SCHEDULED_JOBS.length, concurrency }, "worker.started");
  return {
    boss,
    async stop(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
      log.info({ timeoutMs }, "worker.stopping");
      await boss.stop({ graceful: true, timeout: timeoutMs, close: true });
      log.info("worker.stopped");
    },
  } satisfies RunningWorker;
}
