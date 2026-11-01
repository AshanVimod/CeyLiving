import { execFileSync } from "node:child_process";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

// Starts one throwaway PostgreSQL (the image of infra/docker-compose.dev.yml), creates the two database users of
// DB-10 and applies the real migrations to the `ceyliving` database, which each test file then copies (test/db.ts).
// Docker is required: without it the run stops with a clear message instead of quietly skipping database tests.

declare module "vitest" {
  export interface ProvidedContext {
    /** Connection details of the migrated template database. */
    postgres: { migratorUrl: string; appPassword: string };
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

  project.provide("postgres", { migratorUrl, appPassword: APP_PASSWORD });
  return async () => {
    await container.stop();
  };
}
