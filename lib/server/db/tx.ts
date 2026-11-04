import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { getEnv } from "@/lib/env";
import { Prisma, PrismaClient } from "./generated/client";
import { translateDbError } from "./pg-errors";

// Backend plan 6.1: the handle services pass to repositories. `db` is the shared handle for reads, `withTx` opens a
// transaction. Only repositories look inside a handle (BE-01).

declare const brand: unique symbol;

/** An open PostgreSQL transaction (from `withTx`) or the shared read handle `db`. */
export type Tx = { readonly [brand]: true };

type Client = PrismaClient | Prisma.TransactionClient;

interface Handle {
  readonly client: Client;
  readonly writable: boolean;
}

const asTx = (handle: Handle) => handle as unknown as Tx;
const asHandle = (tx: Tx) => tx as unknown as Handle;

export type Isolation = "ReadCommitted" | "Serializable";

export interface Handles {
  /** BE-03: the shared handle for read-only page queries outside a transaction. Writes through it throw. */
  readonly db: Tx;
  /** DB-04 / DB-05: runs `fn` in one transaction (READ COMMITTED by default) and retries it on conflict. */
  withTx<T>(fn: (tx: Tx) => Promise<T>, opts?: { isolation?: Isolation }): Promise<T>;
}

/** DB-05: a transaction is tried at most this many times when PostgreSQL aborts it over a conflict. */
export const MAX_TX_ATTEMPTS = 3;

/** Handles bound to one client. The app uses `pgHandles()` below; tests pass their own container's client. */
export function handlesFor(getClient: () => PrismaClient): Handles {
  return {
    db: asTx({
      get client() {
        return getClient();
      },
      writable: false,
    }),
    async withTx(fn, opts = {}) {
      const isolationLevel = Prisma.TransactionIsolationLevel[opts.isolation ?? "ReadCommitted"];
      for (let attempt = 1; ; attempt++) {
        try {
          return await getClient().$transaction((client) => fn(asTx({ client, writable: true })), { isolationLevel });
        } catch (error) {
          if (attempt >= MAX_TX_ATTEMPTS || !isRetryable(error)) throw translateDbError(error);
        }
      }
    },
  };
}

/** DB-05: serialization failures (40001) and deadlocks (40P01) are safe to retry: PostgreSQL rolled everything back. */
export function isRetryable(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    const e = current as { code?: unknown; originalCode?: unknown; meta?: unknown; cause?: unknown };
    if (e.code === "P2034" || e.code === "40001" || e.code === "40P01") return true;
    if (e.originalCode === "40001" || e.originalCode === "40P01") return true;
    const meta = e.meta as { driverAdapterError?: unknown } | undefined;
    current = meta?.driverAdapterError ?? e.cause;
  }
  return false;
}

/** A client for one connection string, through the node-postgres driver adapter. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client per server process; kept on globalThis so dev reloads don't open a new pool each time.
const shared = globalThis as unknown as { ceylivingPrisma?: PrismaClient };

/** The app's own client (DB-10: as ceyliving_app). Only Better Auth's adapter (lib/server/better-auth.ts) uses it. */
export function appPrisma(): PrismaClient {
  return appClient();
}

function appClient(): PrismaClient {
  if (shared.ceylivingPrisma) return shared.ceylivingPrisma;
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: see .env.example (DB-10: connect as ceyliving_app).");
  return (shared.ceylivingPrisma = createPrismaClient(url));
}

/** Closes the app's connection pool; the next query opens a new one (from DATABASE_URL as it is then). */
export async function disconnectAppClient(): Promise<void> {
  const client = shared.ceylivingPrisma;
  shared.ceylivingPrisma = undefined;
  await client?.$disconnect();
}

/** The app's handles, connecting as ceyliving_app on first use (DB-10). */
const appHandles: Handles = handlesFor(appClient);

/** BE-03: the shared handle for read-only page queries outside a transaction. Writes through it throw. */
export const db: Tx = appHandles.db;

/** DB-04 / DB-05: runs `fn` in one transaction (READ COMMITTED by default), retried on conflict. */
export const withTx: Handles["withTx"] = (fn, opts) => appHandles.withTx(fn, opts);

/** Repositories only: the Prisma client behind a handle. */
export function clientOf(tx: Tx): Client {
  return asHandle(tx).client;
}

/** Repositories only: the Prisma client behind a handle, for a write. */
export function writableClientOf(tx: Tx): Client {
  const handle = asHandle(tx);
  if (!handle.writable) throw new Error("Writes need a transaction: wrap them in withTx (BE-03).");
  return handle.client;
}

/**
 * Runs `fn` inside a savepoint of the open transaction `tx`. If `fn` throws, only its own writes are undone and the
 * transaction stays usable, so the caller can carry on and commit (B10: an email that can't be queued never undoes
 * the order or payment it is about).
 */
export async function withSavepoint<T>(tx: Tx, name: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[a-z_]{1,40}$/.test(name)) throw new Error(`Bad savepoint name: ${name}`);
  const client = writableClientOf(tx);
  await client.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
}
