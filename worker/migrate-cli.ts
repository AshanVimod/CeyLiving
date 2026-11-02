import { JOB_SCHEMA } from "@/lib/server/jobs/queues";
import { installJobQueue } from "./migrate";

// `npm run jobs:migrate` (worker/migrate.ts). Reads DATABASE_MIGRATION_URL from the environment or .env.local.

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error(
    "DATABASE_MIGRATION_URL is not set: see .env.example (DB-10: the queue is installed as ceyliving_migrator).",
  );
  process.exit(1);
}
installJobQueue(url).then(
  ({ created }) =>
    console.log(
      `Job queue ready in schema "${JOB_SCHEMA}". ${created.length ? `New queues: ${created.join(", ")}.` : "No new queues."}`,
    ),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
