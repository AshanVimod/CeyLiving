// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { loadStoreData } from "@/lib/server/db/load-seed";
import { ConflictError } from "@/lib/server/errors";
import * as catalogueRepo from "@/lib/server/repositories/catalogue";
import { buildSeed } from "@/prisma/seed-data";
import { openTestDatabase } from "@/test/db";

// The seed loader and error translation, which exist only on the PostgreSQL side.

const pg = await openTestDatabase();
afterAll(() => pg.stop());
afterEach(() => vi.unstubAllEnvs());

describe("seed loader and database errors (PostgreSQL only)", () => {
  const { migrator, handles } = pg;

  const counts = async () => {
    const tables = await migrator.$queryRaw<{ name: string }[]>`
      SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename`;
    const result: Record<string, number> = {};
    for (const { name } of tables) {
      const [{ n }] = await migrator.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${name}"`);
      result[name] = n;
    }
    return result;
  };

  it("DB-04 loading the seed twice gives the same rows, never duplicates", async () => {
    const seed = buildSeed(new Date());
    await loadStoreData(migrator, seed, { replace: true });
    const first = await counts();
    const shopsFirst = await catalogueRepo.listShops(handles.db);

    await loadStoreData(migrator, seed, { replace: true });
    expect(await counts()).toEqual(first);
    expect(await catalogueRepo.listShops(handles.db)).toEqual(shopsFirst);
    expect(first.categories).toBe(12);
    expect(first.shops).toBe(seed.shops.length);
    expect(first.products).toBe(seed.products.length);
  });

  it("DB-04 without `replace` the loader refuses a database that already has data", async () => {
    const seed = buildSeed(new Date());
    await loadStoreData(migrator, seed, { replace: true });
    const before = await counts();
    await expect(loadStoreData(migrator, seed)).rejects.toThrow("already has data");
    expect(await counts()).toEqual(before);
  });

  it("SEC-A8 the loader never replaces data in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(loadStoreData(migrator, buildSeed(new Date()), { replace: true })).rejects.toThrow("production");
  });

  it("OPS-03 a CHECK refusal stays an unexpected error, never a ConflictError with database text", async () => {
    await loadStoreData(migrator, buildSeed(new Date()), { replace: true });
    const product = (await catalogueRepo.listProducts(handles.db))[0];
    const error = await handles
      .withTx((tx) =>
        catalogueRepo.updateProduct(tx, product.id, { variants: [{ sku: "A", label: "A", priceCents: 1, stock: 1 }] }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ConflictError);
  });
});
