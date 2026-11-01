import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { Client } from "pg";
import type { PrismaClient } from "@/lib/server/db/generated/client";
import { loadStoreData } from "@/lib/server/db/load-seed";
import { createPrismaClient, handlesFor, type PgHandles } from "@/lib/server/db/pg";
import type { StoreData } from "@/lib/server/store/dev-store";

// Backend plan 15: each contract test file gets its own copy of the migrated database from the global setup
// (test/contract/global-setup.ts), so files run in parallel without seeing each other's rows.

export interface TestDatabase {
  /** Connected as ceyliving_app, the way the app connects (DB-10). */
  app: PrismaClient;
  /** Connected as ceyliving_migrator, the schema owner. Tests use it only to load data. */
  migrator: PrismaClient;
  handles: PgHandles;
  appUrl: string;
  /** Replaces every row with `data`, in one transaction. */
  reset(data: StoreData): Promise<void>;
  stop(): Promise<void>;
}

const withDatabase = (url: string, database: string) => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
};

/** Undefined when Docker isn't available (the global setup has already warned). */
export async function openTestDatabase(): Promise<TestDatabase | undefined> {
  const postgres = inject("postgres");
  if (!postgres) return undefined;

  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: withDatabase(postgres.migratorUrl, "postgres") });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE ceyliving`);
  } finally {
    await admin.end();
  }

  const migratorUrl = withDatabase(postgres.migratorUrl, name);
  const appUrl = new URL(migratorUrl);
  appUrl.username = "ceyliving_app";
  appUrl.password = postgres.appPassword;

  const app = createPrismaClient(appUrl.toString());
  const migrator = createPrismaClient(migratorUrl);
  return {
    app,
    migrator,
    handles: handlesFor(() => app),
    appUrl: appUrl.toString(),
    reset: (data) => loadStoreData(migrator, data, { replace: true }),
    async stop() {
      await Promise.all([app.$disconnect(), migrator.$disconnect()]);
    },
  };
}
