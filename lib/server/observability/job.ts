import "server-only";
import type { Logger } from "pino";
import { z } from "zod";
import { JOBS, type JobName } from "../jobs/queues";
import { alertAdminsOfFailedJob } from "../services/notifications";
import { countEvent } from "../services/ops";

// OPS-03: the job counterpart of runAction and withRoute. Every run logs its outcome and duration with the job's
// id, name and attempt. A failure is logged with the stack and rethrown so pg-boss retries it (JOB-04); the last
// failed try also alerts the admins.

/** What the worker knows about the job it is running (pg-boss's job with metadata). */
export interface RunningJob {
  id: string;
  name: string;
  data: unknown;
  retryCount: number;
  retryLimit: number;
}

/** JOB-01: a handler gets its payload already checked against the job's zod schema, and a logger for the run. */
export type JobHandler<N extends JobName> = (
  data: z.output<(typeof JOBS)[N]["payload"]>,
  log: Logger,
) => Promise<Record<string, unknown> | void>;

export async function runJob<N extends JobName>(
  name: N,
  job: RunningJob,
  handler: JobHandler<N>,
  base: Logger,
): Promise<void> {
  const started = performance.now();
  const attempt = job.retryCount + 1;
  const log = base.child({ jobId: job.id, job: name, attempt });
  const durationMs = () => Math.round(performance.now() - started);

  const parsed = JOBS[name].payload.safeParse(job.data ?? {});
  if (!parsed.success) {
    // A bad payload never gets better on a retry: record it, tell the admins, and finish the job.
    log.error({ issues: parsed.error.issues.map((i) => i.path.join(".") || "(root)") }, "job.invalid_payload");
    await countEvent("job_failed");
    await alertAdminsOfFailedJob(name, job.id);
    return;
  }

  try {
    const result = await handler(parsed.data as never, log);
    log.info({ durationMs: durationMs(), ...(result ?? {}) }, "job.completed");
  } catch (error) {
    const final = job.retryCount >= job.retryLimit;
    log.error({ err: error, durationMs: durationMs(), final }, final ? "job.failed" : "job.retrying");
    if (final) {
      await countEvent("job_failed"); // B12 (OPS-06): never throws
      try {
        await alertAdminsOfFailedJob(name, job.id);
      } catch (alertError) {
        log.error({ err: alertError }, "job.alert_failed");
      }
    }
    throw error;
  }
}
