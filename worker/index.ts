import { getEnv } from "@/lib/env";
import { disconnectAppClient } from "@/lib/server/db/tx";
import { createLogger } from "@/lib/server/observability/logger";
import { startWorker } from "./worker";

// The worker process: `npm run worker` (production) or `npm run dev` (with the web app). It reads the same
// environment as the web app (lib/env.ts) and connects as ceyliving_app (DB-10).

const log = createLogger({ service: "ceyliving-worker" });

async function main() {
  const env = getEnv();
  if (!env.DATABASE_URL)
    throw new Error("DATABASE_URL is not set: see .env.example (DB-10: connect as ceyliving_app).");
  const worker = await startWorker({ connectionString: env.DATABASE_URL, log, concurrency: env.WORKER_CONCURRENCY });

  // JOB-07: on SIGTERM (Docker, deploys) or Ctrl+C, stop taking jobs and let running ones finish (up to 30 seconds).
  // A second signal stops at once; unfinished jobs are retried when a worker starts again (JOB-03 makes that safe).
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) {
      log.warn({ signal }, "worker.forced_exit");
      process.exit(1);
    }
    stopping = true;
    log.info({ signal }, "worker.signal");
    worker
      .stop()
      .then(disconnectAppClient)
      .then(
        () => process.exit(0),
        (error: unknown) => {
          log.error({ err: error }, "worker.stop_failed");
          process.exit(1);
        },
      );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, "worker.start_failed");
  process.exit(1);
});
