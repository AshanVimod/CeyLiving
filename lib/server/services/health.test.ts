// @vitest-environment node
import { readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { EXPECTED_MIGRATION } from "@/lib/server/db/expected-migration";
import { createPrismaClient, disconnectAppClient } from "@/lib/server/db/tx";
import { migratorClient, withTestDatabase } from "@/test/db";
import { readiness } from "./health";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

// B12 (backend plan OPS-05): /api/health says the process is up; /api/ready says the database answers and this
// build's migrations are applied. Neither says why it failed.

withTestDatabase();

const get = (url: string) =>
  new NextRequest(`http://localhost:3000${url}`, { headers: { "x-request-id": "req-health" } });

describe("OPS-05 health and readiness", () => {
  it("OPS-05 the expected migration is the newest folder", () => {
    const folders = readdirSync(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(EXPECTED_MIGRATION).toBe(folders.at(-1));
  });

  it("OPS-05 /api/ready answers 200 when the database answers and the migration is applied", async () => {
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET(get("/api/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("OPS-05 /api/ready answers 503 when the expected migration is missing or rolled back", async () => {
    expect(await readiness(2_000, "29990101000000_not_applied_yet")).toEqual({
      ok: false,
      reason: "migration",
      detail: "missing",
    });
    const c = migratorClient();
    const [row] = await c.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
      EXPECTED_MIGRATION,
    );
    await c.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = $1`, row!.id);
    try {
      expect(await readiness()).toEqual({ ok: false, reason: "migration", detail: "rolled_back" });
      const { GET } = await import("@/app/api/ready/route");
      const response = await GET(get("/api/ready"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false }); // no reason in the answer
    } finally {
      await c.$executeRawUnsafe(`UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE id = $1`, row!.id);
    }
  });

  it("OPS-05 a database ahead of this build is still ready", async () => {
    await migratorClient().$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ('test-ahead', 'test', '29990101000000_from_a_newer_build', now(), now(), 1)`,
    );
    expect(await readiness()).toEqual({ ok: true });
  });

  it("OPS-05 /api/ready answers 503 when the database is down; /api/health still answers", async () => {
    const real = process.env.DATABASE_URL!;
    // A real connection to a port nothing listens on: the same failure as a stopped database, not a mock.
    const down = new URL(real);
    down.port = "1";
    process.env.DATABASE_URL = down.toString();
    await disconnectAppClient();
    try {
      expect(await readiness()).toEqual({ ok: false, reason: "database" });
      const ready = await (await import("@/app/api/ready/route")).GET(get("/api/ready"));
      expect(ready.status).toBe(503);
      expect(await ready.json()).toEqual({ ok: false });
      const health = await (await import("@/app/api/health/route")).GET(get("/api/health"));
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      process.env.DATABASE_URL = real;
      await disconnectAppClient();
    }
  });

  it("OPS-05 the app user can read only the three migration columns, and write nothing there", async () => {
    const app = createPrismaClient(process.env.DATABASE_URL!);
    try {
      const rows = await app.$queryRawUnsafe<unknown[]>(
        `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
      );
      expect(rows.length).toBeGreaterThan(0);
      await expect(app.$queryRawUnsafe(`SELECT checksum FROM "_prisma_migrations"`)).rejects.toThrow(/permission/);
      await expect(app.$queryRawUnsafe(`SELECT logs FROM "_prisma_migrations"`)).rejects.toThrow(/permission/);
      await expect(app.$executeRawUnsafe(`DELETE FROM "_prisma_migrations"`)).rejects.toThrow(/permission/);
    } finally {
      await app.$disconnect();
    }
  });
});
