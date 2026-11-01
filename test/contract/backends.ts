import { afterAll } from "vitest";
import { db as devDb, withTx as devWithTx, type Tx } from "@/lib/server/db/tx";
import { readStore, type StoreData } from "@/lib/server/store/dev-store";
import { buildSeed } from "@/lib/server/store/seed";
import { withTestStore } from "@/test/store-helpers";
import { openTestDatabase, type TestDatabase } from "@/test/db";

// Backend plan 6.2 step 2: each contract file runs one suite against both backends. Shared rules go in
// `for (const [name, backend] of backends)`; rules only PostgreSQL enforces go in a block named "(PostgreSQL only)".

export interface Backend<R> {
  repo: R;
  db: Tx;
  withTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Fresh seed data in the backend; returns what was loaded. */
  reset(): Promise<StoreData>;
}

/**
 * Call once at the top of a test file. `pgRepo` has the same functions with PgTx in place of Tx
 * (repositories/pg/conformance.ts proves it), so the cast below only swaps the handle type.
 */
export async function contractBackends<R>(devRepo: R, pgRepo: unknown) {
  withTestStore();
  const pg: TestDatabase | undefined = await openTestDatabase();
  afterAll(() => pg?.stop());

  const backends: [string, Backend<R> | undefined][] = [
    ["dev store", { repo: devRepo, db: devDb, withTx: devWithTx, reset: async () => readStore() }],
    [
      "PostgreSQL",
      pg && {
        repo: pgRepo as R,
        db: pg.handles.db as unknown as Tx,
        withTx: pg.handles.withTx as unknown as Backend<R>["withTx"],
        async reset() {
          const data = buildSeed(new Date());
          await pg.reset(data);
          return data;
        },
      },
    ],
  ];
  return { backends, pg };
}

export const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));

export const isNewestFirst = (rows: readonly { createdAt: string }[]) =>
  rows.every((row, i) => i === 0 || rows[i - 1].createdAt >= row.createdAt);
