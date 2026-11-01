import { afterAll } from "vitest";
import type { Tx } from "@/lib/server/db/tx";
import { buildSeed, type SeedData } from "@/prisma/seed-data";
import { openTestDatabase } from "@/test/db";

// Repository tests (backend plan 6.2): each file tests one repository module against its own copy of the migrated
// PostgreSQL. Until B04a they also ran against the dev store; the suites keep their shape, with one backend.

export interface Backend<R> {
  repo: R;
  db: Tx;
  withTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Loads the demo data again; returns what was loaded. */
  reset(): Promise<SeedData>;
}

/** Call once at the top of a test file. */
export async function repositoryBackend<R>(repo: R) {
  const pg = await openTestDatabase();
  afterAll(() => pg.stop());

  const backends: [string, Backend<R> | undefined][] = [
    [
      "PostgreSQL",
      {
        repo,
        db: pg.handles.db,
        withTx: pg.handles.withTx,
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
