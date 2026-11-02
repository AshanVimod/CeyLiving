import { randomUUID } from "node:crypto";
import { HANDLERS } from "@/worker/handlers";
import { RETRY_POLICY, type JobName, type JobPayload } from "@/lib/server/jobs/queues";
import { runJob } from "@/lib/server/observability/job";
import { captureLogger } from "./log-capture";

/**
 * B06: runs one job's handler the way the worker does (payload check, logging, alert on the last try), without
 * pg-boss. Returns the log lines the run wrote.
 */
export async function runJobNow<N extends JobName>(
  name: N,
  data: JobPayload<N> = {} as JobPayload<N>,
  attempt: { retryCount?: number } = {},
) {
  const { logger, lines } = captureLogger();
  await runJob(
    name,
    { id: randomUUID(), name, data, retryCount: attempt.retryCount ?? 0, retryLimit: RETRY_POLICY.retryLimit },
    HANDLERS[name],
    logger,
  );
  return lines;
}
