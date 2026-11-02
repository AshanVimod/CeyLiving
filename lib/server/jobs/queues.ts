import { z } from "zod";

// Backend plan 10.2: every background job, its payload and its timing, in one place. The web app enqueues from it
// (lib/server/repositories/jobs.ts), `npm run jobs:migrate` creates the queues from it (worker/migrate.ts) and the
// worker registers a handler and a schedule for each (worker/index.ts). No server-only import: the worker and the
// migrate script load this file outside Next.js.

const empty = z.object({}).strict();

/** pg-boss stores ids as text; ours are prefix_uuid (DB-02). */
const id = z.string().min(3).max(100);

export const JOBS = {
  "email.send": {
    payload: z.object({ template: z.string().min(1).max(60), to: id, data: z.record(z.string(), z.unknown()) }),
  },
  "image.process": { payload: z.object({ uploadId: id }) },
  "orders.expireUnpaid": { payload: z.object({ orderId: id }) },
  "orders.autoCancelUnaccepted": { payload: empty, cron: "*/15 * * * *" },
  "orders.autoComplete": { payload: empty, cron: "5 * * * *" },
  "payouts.generateWeekly": { payload: empty, cron: "0 6 * * 1" },
  "payments.reconcile": { payload: empty, cron: "0 2 * * *" },
  "customRequests.expire": { payload: empty, cron: "10 * * * *" },
  "users.liftExpiredMutes": { payload: empty, cron: "15 * * * *" },
  "reports.autoHide": {
    payload: z.object({ targetType: z.enum(["REVIEW", "QUESTION", "ANSWER"]), targetId: id }),
    // One queued check per post (singletonKey): further reports before it runs are counted by that same check.
    policy: "short",
  },
  "maintenance.cleanup": { payload: empty, cron: "0 3 * * *" },
} as const satisfies Record<string, { payload: z.ZodType<object>; cron?: string; policy?: "short" }>;

export type JobName = keyof typeof JOBS;
export type JobPayload<N extends JobName> = z.input<(typeof JOBS)[N]["payload"]>;

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** Jobs that pg-boss starts on a timetable (JOB-05). Times are Sri Lankan time (Asia/Colombo). */
export const SCHEDULED_JOBS = JOB_NAMES.filter((name) => "cron" in JOBS[name]);

/**
 * JOB-05: each queue's pg-boss policy. Scheduled queues are `stately`: at most one run waiting and one running, so
 * two workers, or a slow run overlapping the next tick, never run the same schedule twice at once.
 */
export function queuePolicy(name: JobName): "standard" | "short" | "stately" {
  const job = JOBS[name];
  if ("cron" in job) return "stately";
  return "policy" in job ? job.policy : "standard";
}

export const SCHEDULE_TIME_ZONE = "Asia/Colombo";

/**
 * JOB-04: a job that fails is tried again after about 30 seconds, then 1, 2 and 4 minutes (exponential backoff),
 * five tries in all. pg-boss keeps a job that fails the last try as failed; the worker logs it as an error and
 * tells the admins (lib/server/observability/job.ts).
 */
export const RETRY_POLICY = { retryLimit: 4, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 } as const;

/** JOB-07: a job taking longer than this is treated as stuck and retried. */
export const JOB_EXPIRE_SECONDS = 15 * 60;

/** pg-boss's own schema (backend plan 7.2): installed by `npm run jobs:migrate`, never by Prisma. */
export const JOB_SCHEMA = "pgboss";
