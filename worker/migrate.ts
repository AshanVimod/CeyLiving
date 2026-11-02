import { Client } from "pg";
import { PgBoss } from "pg-boss";
import { JOB_EXPIRE_SECONDS, JOB_NAMES, JOB_SCHEMA, queuePolicy, RETRY_POLICY } from "@/lib/server/jobs/queues";

// `npm run jobs:migrate`: installs or upgrades pg-boss's tables in the "pgboss" schema and creates the queues of the
// job catalogue. It connects as the schema owner, ceyliving_migrator (DB-10): the app and the worker connect as
// ceyliving_app, which gets data rights on that schema here and can't change its structure. pg-boss versions its own
// schema, so running this again (every deploy, `npm run setup`, the test set-up) only applies what is missing.
// No server-only imports: the test set-up loads this file too.

/** DB-10: the role the app and the worker connect as. */
export const APP_ROLE = "ceyliving_app";

const QUEUE_OPTIONS = { ...RETRY_POLICY, expireInSeconds: JOB_EXPIRE_SECONDS } as const;

export async function installJobQueue(migratorUrl: string, appRole = APP_ROLE): Promise<{ created: string[] }> {
  if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error(`Not a plain role name: ${appRole}`);
  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: JOB_SCHEMA,
    max: 1,
    application_name: "ceyliving-jobs-migrate",
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  boss.on("error", () => undefined); // start() and the calls below reject with the same error.
  await boss.start();
  const created: string[] = [];
  try {
    for (const name of JOB_NAMES) {
      if (await boss.getQueue(name)) {
        // A queue's policy is fixed once created; its retry and expiry settings follow the catalogue.
        await boss.updateQueue(name, QUEUE_OPTIONS);
      } else {
        await boss.createQueue(name, { ...QUEUE_OPTIONS, policy: queuePolicy(name) });
        created.push(name);
      }
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }

  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA ${JOB_SCHEMA} TO ${appRole}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${JOB_SCHEMA} TO ${appRole}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${JOB_SCHEMA} TO ${appRole}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${JOB_SCHEMA} TO ${appRole}`);
  } finally {
    await client.end();
  }
  return { created };
}
