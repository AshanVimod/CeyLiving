import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { getEnv } from "@/lib/env";
import { Prisma, PrismaClient } from "./generated/client";

// Backend plan 6.1, PostgreSQL side: the same handle shape as tx.ts (`db` for reads, `withTx` for writes), backed by
// Prisma. Only repositories under repositories/pg look inside a handle (BE-01). B04 switches services over to it.

declare const brand: unique symbol;

/** An open PostgreSQL transaction (from `withTx`) or the shared read handle `db`. */
export type PgTx = { readonly [brand]: true };

type Client = PrismaClient | Prisma.TransactionClient;

interface Handle {
  readonly client: Client;
  readonly writable: boolean;
}

const asTx = (handle: Handle) => handle as unknown as PgTx;
const asHandle = (tx: PgTx) => tx as unknown as Handle;

export type Isolation = "ReadCommitted" | "Serializable";

export interface PgHandles {
  /** BE-03: the shared handle for read-only page queries outside a transaction. Writes through it throw. */
  readonly db: PgTx;
  /** DB-04 / DB-05: runs `fn` in one transaction (READ COMMITTED by default) and retries it on conflict. */
  withTx<T>(fn: (tx: PgTx) => Promise<T>, opts?: { isolation?: Isolation }): Promise<T>;
}

/** DB-05: a transaction is tried at most this many times when PostgreSQL aborts it over a conflict. */
export const MAX_TX_ATTEMPTS = 3;

/** Handles bound to one client. The app uses `pgHandles()` below; tests pass their own container's client. */
export function handlesFor(getClient: () => PrismaClient): PgHandles {
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
          if (attempt >= MAX_TX_ATTEMPTS || !isRetryable(error)) throw error;
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

function appClient(): PrismaClient {
  if (shared.ceylivingPrisma) return shared.ceylivingPrisma;
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: see .env.example (DB-10: connect as ceyliving_app).");
  return (shared.ceylivingPrisma = createPrismaClient(url));
}

/** The app's handles, connecting as ceyliving_app on first use (DB-10). */
export const pgHandles: PgHandles = handlesFor(appClient);

/** Repositories only: the Prisma client behind a handle. */
export function clientOf(tx: PgTx): Client {
  return asHandle(tx).client;
}

/** Repositories only: the Prisma client behind a handle, for a write. */
export function writableClientOf(tx: PgTx): Client {
  const handle = asHandle(tx);
  if (!handle.writable) throw new Error("Writes need a transaction: wrap them in withTx (BE-03).");
  return handle.client;
}
