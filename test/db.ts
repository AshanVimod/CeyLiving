import { execFileSync } from "node:child_process";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import type { PrismaClient } from "@/lib/server/db/generated/client";
import { loadStoreData } from "@/lib/server/db/load-seed";
import { createPrismaClient, handlesFor, type PgHandles } from "@/lib/server/db/pg";
import type { StoreData } from "@/lib/server/store/dev-store";

// Backend plan 15: a throwaway PostgreSQL in Docker (Testcontainers) with the real migrations applied, the same image
// as infra/docker-compose.dev.yml, and the two database users of DB-10. Without Docker the tests that need it are
// skipped with a warning locally; in CI (CI=true) a missing Docker fails the run instead.

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Connected as ceyliving_app, the way the app connects (DB-10). */
  app: PrismaClient;
  /** Connected as ceyliving_migrator, the schema owner. Tests use it only to reset and load data. */
  migrator: PrismaClient;
  handles: PgHandles;
  appUrl: string;
  /** Empties the tables and loads `data` (DB-04: in one transaction). */
  reset(data: StoreData): Promise<void>;
  stop(): Promise<void>;
}

const APP_PASSWORD = "test_app";

export async function startTestDatabase(): Promise<TestDatabase | undefined> {
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer("postgres:17.11-alpine")
      .withUsername("ceyliving_migrator")
      .withPassword("test_migrator")
      .withDatabase("ceyliving")
      .start();
  } catch (error) {
    if (process.env.CI) throw error;
    console.warn(`PostgreSQL tests skipped: Docker is not available (${(error as Error).message.split("\n")[0]})`);
    return undefined;
  }

  const migratorUrl = container.getConnectionUri();
  const url = new URL(migratorUrl);
  url.username = "ceyliving_app";
  url.password = APP_PASSWORD;
  const appUrl = url.toString();

  const admin = new Client({ connectionString: migratorUrl });
  await admin.connect();
  await admin.query(`CREATE ROLE ceyliving_app LOGIN PASSWORD '${APP_PASSWORD}'`);
  await admin.end();

  execFileSync(process.execPath, [path.join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_MIGRATION_URL: migratorUrl },
    stdio: "pipe",
  });

  const app = createPrismaClient(appUrl);
  const migrator = createPrismaClient(migratorUrl);
  return {
    container,
    app,
    migrator,
    handles: handlesFor(() => app),
    appUrl,
    async reset(data) {
      // Every table, not only the loaded ones, so foreign keys never block the TRUNCATE.
      const tables = await migrator.$queryRaw<{ name: string }[]>`
        SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      await migrator.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.name}"`).join(", ")} RESTART IDENTITY`);
      await loadStoreData(migrator, data);
    },
    async stop() {
      await Promise.all([app.$disconnect(), migrator.$disconnect()]);
      await container.stop();
    },
  };
}
