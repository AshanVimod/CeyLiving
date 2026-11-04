import { execFileSync } from "node:child_process";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import type { TestProject } from "vitest/node";
import { installJobQueue } from "../worker/migrate";

// Starts one throwaway PostgreSQL (the image of infra/docker-compose.dev.yml), creates the two database users of
// DB-10, applies the real migrations and installs the job queue (B06) in the `ceyliving` database, which each test
// file then copies (test/db.ts).
// B10: also starts one Mailpit, which the email tests send to and read back from; nothing leaves the machine.
// Docker is required: without it the run stops with a clear message instead of quietly skipping database tests.

declare module "vitest" {
  export interface ProvidedContext {
    /** Connection details of the migrated template database. */
    postgres: { migratorUrl: string; appPassword: string };
    /** B10: one throwaway Mailpit (the image of infra/docker-compose.dev.yml): its SMTP address and its API. */
    mailpit: { smtpUrl: string; apiUrl: string };
  }
}

const APP_PASSWORD = "test_app";

export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:17.11-alpine")
      .withUsername("ceyliving_migrator")
      .withPassword("test_migrator")
      .withDatabase("ceyliving")
      .start();
  } catch (error) {
    const reason = (error as Error).message.split("\n")[0];
    throw new Error(
      `The tests need Docker, to run a throwaway PostgreSQL. Start Docker Desktop and run the tests again.\n(${reason})`,
    );
  }

  const migratorUrl = container.getConnectionUri();
  const admin = new Client({ connectionString: migratorUrl });
  await admin.connect();
  await admin.query(`CREATE ROLE ceyliving_app LOGIN PASSWORD '${APP_PASSWORD}'`);
  await admin.end();

  execFileSync(process.execPath, [path.join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_MIGRATION_URL: migratorUrl },
    stdio: "pipe",
  });
  // B06: the job queue's tables (schema pgboss), as `npm run jobs:migrate` installs them.
  await installJobQueue(migratorUrl);

  const mailpit: StartedTestContainer = await new GenericContainer("axllent/mailpit:v1.33.0")
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
  const host = mailpit.getHost();

  project.provide("postgres", { migratorUrl, appPassword: APP_PASSWORD });
  project.provide("mailpit", {
    smtpUrl: `smtp://${host}:${mailpit.getMappedPort(1025)}`,
    apiUrl: `http://${host}:${mailpit.getMappedPort(8025)}`,
  });
  return async () => {
    await Promise.all([container.stop(), mailpit.stop()]);
  };
}
