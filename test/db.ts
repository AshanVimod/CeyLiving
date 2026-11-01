import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";
import { Client } from "pg";
import type { PrismaClient } from "@/lib/server/db/generated/client";
import { loadStoreData } from "@/lib/server/db/load-seed";
import {
  payoutInclude,
  productInclude,
  toAddress,
  toAnswer,
  toApplication,
  toAuditEntry,
  toCustomRequest,
  toNotification,
  toOrder,
  toOrderItem,
  toPayout,
  toProduct,
  toQuestion,
  toRateEvent,
  toReport,
  toReview,
  toSellerOrder,
  toShop,
  toUser,
  toVote,
} from "@/lib/server/db/mappers";
import { createPrismaClient, disconnectAppClient, handlesFor, type Handles } from "@/lib/server/db/tx";
import type { User } from "@/lib/types";
import { buildSeed, type SeedData } from "@/prisma/seed-data";

// Backend plan 15: every test file gets its own copy of the migrated database from the global setup
// (test/global-setup.ts), so files run in parallel without seeing each other's rows.

export interface TestDatabase {
  /** Connected as ceyliving_app, the way the app connects (DB-10). */
  app: PrismaClient;
  /** Connected as ceyliving_migrator, the schema owner. Tests use it only to load and read back data. */
  migrator: PrismaClient;
  handles: Handles;
  appUrl: string;
  migratorUrl: string;
  /** Replaces every row with `data`, in one transaction. */
  reset(data: SeedData): Promise<void>;
  stop(): Promise<void>;
}

const withDatabase = (url: string, database: string) => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
};

/** A fresh copy of the migrated database, for this test file only. */
export async function openTestDatabase(): Promise<TestDatabase> {
  const postgres = inject("postgres");
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
    migratorUrl,
    reset: (data) => loadStoreData(migrator, data, { replace: true }),
    async stop() {
      await Promise.all([app.$disconnect(), migrator.$disconnect()]);
    },
  };
}

let database: TestDatabase | undefined;
let loaded: SeedData | undefined;

/**
 * Call once at the top of a test file whose code under test uses the app's `db` and `withTx`. The app connects to
 * this file's database, and the demo data is loaded again before every test, so each test starts from the seed.
 */
export function withTestDatabase() {
  beforeAll(async () => {
    database = await openTestDatabase();
    process.env.DATABASE_URL = database.appUrl;
    await disconnectAppClient();
  });
  beforeEach(async () => {
    loaded = buildSeed(new Date());
    await database!.reset(loaded);
  });
  afterAll(async () => {
    await disconnectAppClient();
    await database?.stop();
  });
}

function current(): TestDatabase {
  if (!database) throw new Error("Call withTestDatabase() at the top of the test file first.");
  return database;
}

/**
 * A user as last loaded (before this test, or by changeData). A user a service has changed since (for example an
 * applicant who became a seller) is read with readAll() instead.
 */
export function user(id: string): User {
  const found = loaded?.users.find((u) => u.id === id);
  if (!found) throw new Error(`Seed user ${id} missing`);
  return found;
}

/** A user as stored right now, after whatever the test's services changed. */
export async function freshUser(id: string): Promise<User> {
  const row = await current().migrator.user.findUnique({ where: { id } });
  if (!row) throw new Error(`User ${id} missing`);
  return toUser(row);
}

/** Every row in this file's database, table by table, as the app's domain objects. */
export async function readAll(): Promise<SeedData> {
  const c = current().migrator;
  const byCreated = [{ createdAt: "asc" }, { id: "asc" }] as const;
  return {
    users: (await c.user.findMany({ orderBy: [...byCreated] })).map(toUser),
    applications: (await c.sellerApplication.findMany({ orderBy: [...byCreated] })).map(toApplication),
    shops: (await c.shop.findMany({ orderBy: [...byCreated] })).map(toShop),
    products: (await c.product.findMany({ include: productInclude, orderBy: [...byCreated] })).map(toProduct),
    orders: (await c.order.findMany({ orderBy: [{ placedAt: "asc" }, { id: "asc" }] })).map(toOrder),
    sellerOrders: (await c.sellerOrder.findMany({ orderBy: { id: "asc" } })).map(toSellerOrder),
    orderItems: (await c.orderItem.findMany({ orderBy: { id: "asc" } })).map(toOrderItem),
    reviews: (await c.review.findMany({ orderBy: [...byCreated] })).map(toReview),
    questions: (await c.productQuestion.findMany({ orderBy: [...byCreated] })).map(toQuestion),
    answers: (await c.productAnswer.findMany({ orderBy: [...byCreated] })).map(toAnswer),
    reports: (await c.report.findMany({ orderBy: [...byCreated] })).map(toReport),
    auditLog: (await c.auditLogEntry.findMany({ orderBy: [...byCreated] })).map(toAuditEntry),
    notifications: (await c.notification.findMany({ orderBy: [...byCreated] })).map(toNotification),
    addresses: (await c.address.findMany({ orderBy: { id: "asc" } })).map(toAddress),
    rateEvents: (await c.rateEvent.findMany({ orderBy: { id: "asc" } })).map(toRateEvent),
    payouts: (await c.payout.findMany({ include: payoutInclude, orderBy: [...byCreated] })).map(toPayout),
    customRequests: (await c.customRequest.findMany({ orderBy: [...byCreated] })).map(toCustomRequest),
    helpfulVotes: (await c.helpfulVote.findMany({ orderBy: [{ createdAt: "asc" }, { userId: "asc" }] })).map(toVote),
  };
}

/**
 * Test set-up only: changes rows directly (for a state no service can reach quickly, like an order delivered
 * 40 days ago), then loads the result back in one transaction.
 */
export async function changeData<T>(change: (data: SeedData) => T | Promise<T>): Promise<T> {
  const data = await readAll();
  const result = await change(data);
  await current().reset(data);
  loaded = data;
  return result;
}
