import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import * as devPeople from "@/lib/server/repositories/people";
import * as pgPeople from "@/lib/server/repositories/pg/people";
import { clientOf, MAX_TX_ATTEMPTS } from "@/lib/server/db/pg";
import type { StoreData } from "@/lib/server/store/dev-store";
import { buildSeed } from "@/lib/server/store/seed";
import type { SellerApplication } from "@/lib/types";
import { byId, contractBackends, isNewestFirst } from "./backends";

// Users, applications, addresses, notifications, the audit log and rate events: the same suite on both backends,
// then what only PostgreSQL guarantees (constraints, database rights, retries).

const { backends, pg } = await contractBackends(devPeople, pgPeople);

function application(id: string, userId: string, createdAt: string): SellerApplication {
  return {
    id,
    userId,
    applicantName: "Test Applicant",
    phone: "0771234567",
    businessType: "INDIVIDUAL",
    shopName: `Shop ${id}`,
    craft: "Wood carving",
    categorySlugs: ["masks"],
    address: { line1: "12 Temple Road", city: "Galle", district: "Galle" },
    story: "Three generations of carvers.",
    workPhotoUrls: [],
    acceptedTermsAt: createdAt,
    status: "PENDING",
    createdAt,
    updatedAt: createdAt,
  };
}

for (const [name, backend] of backends) {
  describe.skipIf(!backend)(`people repository contract: ${name}`, () => {
    if (!backend) return; // describe bodies still run when skipped
    const { repo, db, withTx, reset } = backend;
    let seed: StoreData;
    beforeEach(async () => {
      seed = await reset();
    });

    it("BE-01 returns the stored users as domain objects, and undefined for an unknown id", async () => {
      expect(byId(await repo.listUsers(db))).toEqual(byId(seed.users));
      expect(await repo.findUserById(db, "user_admin")).toEqual(seed.users.find((u) => u.id === "user_admin"));
      expect(await repo.findUserById(db, "user_nobody")).toBeUndefined();
      expect(await repo.listAdminIds(db)).toEqual(seed.users.filter((u) => u.role === "ADMIN").map((u) => u.id));
    });

    it("BE-01 updateUser applies a patch, and a key set to undefined clears that field", async () => {
      const until = "2030-01-01T00:00:00.000Z";
      await withTx((tx) =>
        repo.updateUser(tx, "user_customer", {
          postingRestriction: "MUTED",
          mutedUntil: until,
          restrictionReason: "x",
        }),
      );
      expect(await repo.findUserById(db, "user_customer")).toMatchObject({ mutedUntil: until, restrictionReason: "x" });

      const cleared = await withTx((tx) =>
        repo.updateUser(tx, "user_customer", {
          postingRestriction: "NONE",
          mutedUntil: undefined,
          restrictionReason: undefined,
        }),
      );
      expect(cleared.mutedUntil).toBeUndefined();
      expect(cleared.restrictionReason).toBeUndefined();
      expect(await repo.findUserById(db, "user_customer")).toEqual(cleared);
      await expect(withTx((tx) => repo.updateUser(tx, "user_nobody", { name: "x" }))).rejects.toThrow("missing");
    });

    it("FR-2a stores an application with its address and lists a person's applications newest first", async () => {
      const older = application("app_older", "user_customer", "2026-10-01T10:00:00.000Z");
      const newer = { ...application("app_newer", "user_customer", "2026-10-02T10:00:00.000Z"), status: "WITHDRAWN" };
      await withTx(async (tx) => {
        await repo.insertApplication(tx, { ...older, status: "REJECTED", businessRegNo: undefined });
        await repo.insertApplication(tx, newer as SellerApplication);
      });
      const mine = await repo.applicationsOf(db, "user_customer");
      expect(mine.map((a) => a.id)).toEqual(["app_newer", "app_older"]);
      expect(mine[1]).toEqual({ ...older, status: "REJECTED" });
      expect(await repo.findApplicationById(db, "app_newer")).toEqual(newer);
      expect(isNewestFirst(await repo.listApplications(db))).toBe(true);
    });

    it("DB-06 updateApplication with `from` changes nothing once the status has moved on", async () => {
      await withTx((tx) =>
        repo.insertApplication(tx, application("app_1", "user_customer", "2026-10-01T10:00:00.000Z")),
      );
      const decided = { status: "APPROVED" as const, decidedById: "user_admin", decidedAt: "2026-10-03T10:00:00.000Z" };

      const first = await withTx((tx) => repo.updateApplication(tx, "app_1", decided, { from: "PENDING" }));
      expect(first).toMatchObject(decided);
      const second = await withTx((tx) =>
        repo.updateApplication(tx, "app_1", { status: "REJECTED" }, { from: "PENDING" }),
      );
      expect(second).toBeUndefined();
      expect((await repo.findApplicationById(db, "app_1"))?.status).toBe("APPROVED");
      expect(await withTx((tx) => repo.updateApplication(tx, "app_none", { status: "REJECTED" }))).toBeUndefined();
    });

    it("FR-17 deletes only the user's own addresses", async () => {
      const address = { ...seed.addresses[0], id: "addr_work", label: "Work" };
      await withTx((tx) => repo.insertAddress(tx, address));
      expect(byId(await repo.addressesOf(db, "user_customer"))).toEqual(byId([...seed.addresses, address]));

      expect(await withTx((tx) => repo.deleteAddress(tx, "addr_work", "user_seller"))).toBe(false);
      expect(await withTx((tx) => repo.deleteAddress(tx, "addr_work", "user_customer"))).toBe(true);
      await withTx((tx) => repo.deleteAddressesOf(tx, "user_customer"));
      expect(await repo.addressesOf(db, "user_customer")).toEqual([]);
    });

    it("RULE-N1 marks only the user's own unread notifications as read", async () => {
      await withTx(async (tx) => {
        await repo.addNotification(tx, "user_customer", "test", "One", "/a");
        await repo.addNotification(tx, "user_customer", "test", "Two", "/b");
        await repo.addNotification(tx, "user_seller", "test", "Other person", "/c");
      });
      const mine = await repo.notificationsOf(db, "user_customer");
      expect(mine.filter((n) => n.type === "test").map((n) => n.title)).toEqual(expect.arrayContaining(["One", "Two"]));
      expect(mine.filter((n) => n.type === "test")).toHaveLength(2);
      expect(isNewestFirst(mine)).toBe(true);
      const one = mine.find((n) => n.title === "One")!;
      const at = "2026-10-05T10:00:00.000Z";

      await withTx((tx) => repo.markNotificationsRead(tx, "user_customer", at, [one.id]));
      const afterOne = await repo.notificationsOf(db, "user_customer");
      expect(afterOne.find((n) => n.title === "One")?.readAt).toBe(at);
      expect(afterOne.find((n) => n.title === "Two")?.readAt).toBeUndefined();

      await withTx((tx) => repo.markNotificationsRead(tx, "user_customer", "2026-10-06T10:00:00.000Z"));
      expect((await repo.notificationsOf(db, "user_customer")).every((n) => n.readAt)).toBe(true);
      expect((await repo.notificationsOf(db, "user_customer")).find((n) => n.title === "One")?.readAt).toBe(at);
      const other = (await repo.notificationsOf(db, "user_seller")).find((n) => n.title === "Other person");
      expect(other?.readAt).toBeUndefined();

      await withTx((tx) => repo.deleteNotificationsOf(tx, "user_customer"));
      expect(await repo.notificationsOf(db, "user_customer")).toEqual([]);
    });

    it("SEC-A9 keeps audit entries with their before and after values, newest first", async () => {
      const entry = {
        actorId: "user_admin",
        action: "user.mute",
        targetType: "USER",
        targetId: "user_customer",
        reason: "spam",
        before: { postingRestriction: "NONE", tags: ["a", 1, null] },
        after: { postingRestriction: "MUTED" },
      };
      await withTx((tx) => repo.addAuditEntry(tx, entry));
      const log = await repo.listAuditLog(db);
      expect(log[0]).toMatchObject(entry);
      expect(log[0].id).toMatch(/^audit_/);
      expect(isNewestFirst(log)).toBe(true);
    });

    it("SEC-A6 counts rate events since a time, and prunes old ones", async () => {
      const at = (iso: string) => ({ userId: "user_customer", kind: "review", at: iso });
      await withTx(async (tx) => {
        await repo.insertRateEvent(tx, at("2026-10-01T10:00:00.000Z"));
        await repo.insertRateEvent(tx, at("2026-10-02T10:00:00.000Z"));
        await repo.insertRateEvent(tx, { ...at("2026-10-02T10:00:00.000Z"), kind: "question" });
      });
      const since = Date.parse("2026-10-01T12:00:00.000Z");
      expect(await repo.countRateEvents(db, "user_customer", "review", since)).toBe(1);
      expect(await repo.countRateEvents(db, "user_customer", "review", 0)).toBe(2);

      await withTx((tx) => repo.pruneRateEvents(tx, since));
      expect(await repo.countRateEvents(db, "user_customer", "review", 0)).toBe(1);
      await withTx((tx) => repo.deleteRateEventsOf(tx, "user_customer"));
      expect(await repo.countRateEvents(db, "user_customer", "question", 0)).toBe(0);
    });

    it("DB-04 withTx writes nothing when a later step fails", async () => {
      await expect(
        withTx(async (tx) => {
          await repo.addNotification(tx, "user_customer", "test", "Lost", "/");
          throw new Error("second step failed");
        }),
      ).rejects.toThrow("second step failed");
      expect((await repo.notificationsOf(db, "user_customer")).some((n) => n.title === "Lost")).toBe(false);
    });

    it("BE-03 the shared read handle refuses writes", async () => {
      await expect(repo.addNotification(db, "user_customer", "test", "x", "/")).rejects.toThrow("withTx");
    });
  });
}

describe.skipIf(!pg)("people (PostgreSQL only)", () => {
  if (!pg) return;
  const { handles, appUrl } = pg;
  beforeAll(() => pg.reset(buildSeed(new Date())));

  const asApp = async (sql: string) => {
    const client = new Client({ connectionString: appUrl });
    await client.connect();
    try {
      return await client.query(sql);
    } finally {
      await client.end();
    }
  };

  it("DB-09 the app's database user can add audit entries but never change or delete them", async () => {
    await handles.withTx((tx) =>
      pgPeople.addAuditEntry(tx, { actorId: "user_admin", action: "a", targetType: "USER", targetId: "user_admin" }),
    );
    await expect(asApp(`UPDATE audit_log SET reason = 'changed'`)).rejects.toThrow(/permission denied/);
    await expect(asApp(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/);
    await expect(asApp(`TRUNCATE audit_log`)).rejects.toThrow(/permission denied/);
  });

  it("DB-10 the app's database user cannot change the schema or read the migration history", async () => {
    await expect(asApp(`CREATE TABLE intruder (id int)`)).rejects.toThrow(/permission denied/);
    await expect(asApp(`DROP TABLE users`)).rejects.toThrow(/must be owner/);
    await expect(asApp(`SELECT * FROM _prisma_migrations`)).rejects.toThrow(/permission denied/);
  });

  it("RULE-A1 the database allows only one open application per person", async () => {
    const created = "2026-10-01T10:00:00.000Z";
    await handles.withTx((tx) => pgPeople.insertApplication(tx, application("app_a", "user_seller", created)));
    await expect(
      handles.withTx((tx) => pgPeople.insertApplication(tx, application("app_b", "user_seller", created))),
    ).rejects.toThrow();
    await handles.withTx((tx) => pgPeople.updateApplication(tx, "app_a", { status: "REJECTED" }));
    await handles.withTx((tx) => pgPeople.insertApplication(tx, application("app_b", "user_seller", created)));
  });

  it("DB-07 CHECK constraints refuse an upper-case email and an application without categories", async () => {
    await expect(asApp(`UPDATE users SET email = 'Upper@Example.lk' WHERE id = 'user_admin'`)).rejects.toThrow(
      /check constraint/,
    );
    const empty = { ...application("app_empty", "user_admin", "2026-10-01T10:00:00.000Z"), categorySlugs: [] };
    await expect(handles.withTx((tx) => pgPeople.insertApplication(tx, empty))).rejects.toThrow();
  });

  it("DB-05 withTx retries a transaction PostgreSQL aborted over a conflict, at most three times", async () => {
    const conflict = `DO $$ BEGIN RAISE EXCEPTION 'conflict' USING ERRCODE = 'serialization_failure'; END $$`;
    let attempts = 0;
    const result = await handles.withTx(async (tx) => {
      attempts++;
      await pgPeople.addNotification(tx, "user_admin", "test", "Retried", "/");
      if (attempts < 2) await clientOf(tx).$executeRawUnsafe(conflict);
      return "done";
    });
    expect(result).toBe("done");
    expect(attempts).toBe(2);
    const titles = (await pgPeople.notificationsOf(handles.db, "user_admin")).map((n) => n.title);
    expect(titles.filter((t) => t === "Retried")).toHaveLength(1);

    attempts = 0;
    await expect(
      handles.withTx(async (tx) => {
        attempts++;
        await clientOf(tx).$executeRawUnsafe(conflict);
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(MAX_TX_ATTEMPTS);
  });

  it("DB-05 withTx does not retry other errors", async () => {
    let attempts = 0;
    await expect(
      handles.withTx(async () => {
        attempts++;
        throw new Error("not a conflict");
      }),
    ).rejects.toThrow("not a conflict");
    expect(attempts).toBe(1);
  });
});
