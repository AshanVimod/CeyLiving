import "server-only";
import { readStore, transaction, type StoreData } from "../store/dev-store";

// Backend plan 6.1: the handle services pass to repositories. Today it wraps the dev store; in B03 it becomes
// Prisma's transaction client, and callers stay the same. Only repositories look inside a handle (BE-01).

declare const brand: unique symbol;

/** An open transaction (from `withTx`) or the shared read handle `db`. */
export type Tx = { readonly [brand]: true };

interface Handle {
  readonly data: StoreData;
  readonly writable: boolean;
}

const asTx = (handle: Handle) => handle as unknown as Tx;
const asHandle = (tx: Tx) => tx as unknown as Handle;

/** BE-03: the shared handle for read-only page queries outside a transaction. Writes through it throw. */
export const db: Tx = asTx({
  get data() {
    return readStore();
  },
  writable: false,
});

/**
 * DB-04: runs `fn` in one transaction. Every write inside lands together, or none does if `fn` throws.
 * Transactions run one at a time.
 */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction((data) => fn(asTx({ data, writable: true })));
}

/** Repositories only: the rows behind a handle. */
export function rowsOf(tx: Tx): StoreData {
  return asHandle(tx).data;
}

/** Repositories only: the rows behind a handle, for a write. */
export function writableRowsOf(tx: Tx): StoreData {
  const handle = asHandle(tx);
  if (!handle.writable) throw new Error("Writes need a transaction: wrap them in withTx (BE-03).");
  return handle.data;
}

/**
 * Repositories only: what a read returns. Inside a transaction rows are private draft objects, so callers get
 * frozen copies and can change data only through repository writes. Shared reads are already frozen.
 */
export function out<T>(tx: Tx, value: T): T {
  return asHandle(tx).writable ? deepFreeze(structuredClone(value)) : value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
