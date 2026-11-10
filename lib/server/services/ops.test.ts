// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPS_ALERT_RULES, OPS_BUCKET_MS, OPS_EVENT_KINDS, type OpsEventKind } from "@/lib/config";
import { withTx } from "@/lib/server/db/tx";
import { ForbiddenError } from "@/lib/server/errors";
import { incrementEventCount } from "@/lib/server/repositories/ops";
import { migratorClient, user, withTestDatabase } from "@/test/db";
import { cleanUpOldRows } from "./maintenance";
import { countEvent, currentFindings, operationsOverview, recordCheckpoint, settleEventCounts, watchOps } from "./ops";

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", async () => (await import("@/test/auth")).nextHeaders);
// The disk check reads the machine running the tests; pin it at 10% used so it never adds an alert here.
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  statfs: async () => ({ blocks: 100, bavail: 90, bsize: 4096 }),
}));

// B12 (backend plan OPS-06, OPS-07, A09): security events are counted (counts only), turned into admin alerts at
// most once an hour per kind (sooner when a problem gets much worse), and shown on the Operations card.

withTestDatabase();

const NOW = new Date("2026-11-10T09:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

beforeEach(async () => {
  await settleEventCounts(); // nothing from the previous test may land in this one
  const c = migratorClient();
  await c.$executeRawUnsafe("DELETE FROM ops_event_counts");
  await c.$executeRawUnsafe("DELETE FROM ops_alerts");
  await c.$executeRawUnsafe("DELETE FROM ops_checkpoints");
});

async function counts(): Promise<Record<string, number>> {
  await settleEventCounts();
  const rows = await migratorClient().opsEventCount.groupBy({ by: ["kind"], _sum: { count: true } });
  return Object.fromEntries(rows.map((r) => [r.kind, r._sum.count ?? 0]));
}

async function times(kind: OpsEventKind, n: number, at = NOW) {
  for (let i = 0; i < n; i++) await countEvent(kind, at);
  await settleEventCounts();
}

/** Only the event rules: live limits (connections, disk) depend on the machine running the tests. */
async function eventFindings(at = NOW) {
  return (await currentFindings(at)).filter((f) => (OPS_EVENT_KINDS as readonly string[]).includes(f.kind));
}

const opsNotifications = () =>
  migratorClient().notification.findMany({ where: { type: { startsWith: "ops." } }, orderBy: { createdAt: "asc" } });
const alertEmails = () => migratorClient().emailDelivery.findMany({ where: { template: "ops.alert" } });

describe("A09 counting events", () => {
  it("A09 concurrent events all count, even past the time a request waits for them", async () => {
    await Promise.all(Array.from({ length: 25 }, () => countEvent("sign_in_failed", NOW)));
    expect((await counts()).sign_in_failed).toBe(25);
  });

  it("A09 events land in 5-minute buckets", async () => {
    await countEvent("server_error", NOW);
    await countEvent("server_error", new Date(NOW.getTime() + OPS_BUCKET_MS));
    await settleEventCounts();
    expect(await migratorClient().opsEventCount.count()).toBe(2);
  });

  it("A09 a counter failure never breaks the request", async () => {
    // A kind the database's CHECK refuses stands in for any database failure.
    await expect(countEvent("Not A Kind" as OpsEventKind, NOW)).resolves.toBeUndefined();
  });

  it("A09 a counter survives the rollback of the transaction that failed", async () => {
    await expect(
      withTx(async () => {
        await countEvent("payment_signature_failed", NOW); // its own transaction, as in the services
        throw new Error("the business change rolls back");
      }),
    ).rejects.toThrow("rolls back");
    expect((await counts()).payment_signature_failed).toBe(1);
  });
});

describe("OPS-06 alert rules", () => {
  it.each(OPS_EVENT_KINDS.map((kind) => [kind, OPS_ALERT_RULES[kind]] as const))(
    "OPS-06 %s fires at its threshold and not below",
    async (kind, rule) => {
      await withTx(async (tx) => {
        // Straight to the counter: thousands of countEvent calls would only slow the test down.
        for (let i = 0; i < rule.threshold - 1; i++) await incrementEventCount(tx, kind, minutes(-1));
      });
      expect((await eventFindings()).map((f) => f.kind)).not.toContain(kind);
      await withTx((tx) => incrementEventCount(tx, kind, minutes(-1)));
      expect(await eventFindings()).toContainEqual(expect.objectContaining({ kind, count: rule.threshold }));
    },
  );

  it("OPS-06 events older than the rule's window don't count", async () => {
    await times("job_failed", 1, minutes(-20));
    expect(await eventFindings()).toEqual([]);
  });

  it("OPS-06 a critical alert goes to every admin by email and in the app; a normal one in the app only", async () => {
    await times("job_failed", 1);
    await times("origin_rejected", OPS_ALERT_RULES.origin_rejected.threshold);
    const result = await watchOps(NOW);
    expect(result.alerted.sort()).toEqual(["job_failed", "origin_rejected"]);
    const notes = await opsNotifications();
    expect(notes.map((n) => [n.userId, n.type])).toEqual(
      expect.arrayContaining([
        ["user_admin", "ops.critical"],
        ["user_admin", "ops.normal"],
      ]),
    );
    const emails = await alertEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ userId: "user_admin", status: "QUEUED" });
    expect(emails[0]!.data).toMatchObject({ label: OPS_ALERT_RULES.job_failed.label, worse: false });
  });

  it("OPS-06 one alert per kind per hour, across two runs at once", async () => {
    await times("job_failed", 1);
    const [a, b] = await Promise.all([watchOps(NOW), watchOps(NOW)]);
    expect([...a.alerted, ...b.alerted]).toEqual(["job_failed"]);
    await times("job_failed", 1, minutes(10));
    expect((await watchOps(minutes(10))).alerted).toEqual([]);
    expect(await opsNotifications()).toHaveLength(1);
    expect(await alertEmails()).toHaveLength(1);
  });

  it("OPS-06 a continuing problem alerts again after an hour, read or not", async () => {
    await times("job_failed", 1);
    await watchOps(NOW);
    await migratorClient().notification.updateMany({ data: { readAt: minutes(5) } }); // acknowledged
    await times("job_failed", 1, minutes(61));
    expect((await watchOps(minutes(61))).alerted).toEqual(["job_failed"]);
    expect(await alertEmails()).toHaveLength(2);
    expect((await opsNotifications()).at(-1)!.title).not.toMatch(/^Getting worse/);
  });

  it("OPS-06 a problem 4 times worse alerts early, once", async () => {
    await times("payout_reveal_failed", 3);
    await watchOps(NOW);
    await times("payout_reveal_failed", 8, minutes(5)); // 11 in the window: not yet 4 times 3
    expect((await watchOps(minutes(5))).alerted).toEqual([]);
    await times("payout_reveal_failed", 1, minutes(6)); // 12: 4 times the 3 last reported
    expect((await watchOps(minutes(6))).alerted).toEqual(["payout_reveal_failed"]);
    expect((await opsNotifications()).at(-1)!.title).toMatch(/^Getting worse: /);
    expect((await watchOps(minutes(7))).alerted).toEqual([]); // the same level doesn't alert again
    const emails = await alertEmails();
    expect(emails.map((e) => (e.data as { worse: boolean }).worse)).toEqual([false, true]);
  });

  it("OPS-06 an alert holds no address, IP or person", async () => {
    await times("sign_in_failed", OPS_ALERT_RULES.sign_in_failed.threshold);
    await watchOps(NOW);
    // Each notification and email is addressed to an admin, of course; what it says must name nobody.
    const text = JSON.stringify([
      (await opsNotifications()).map((n) => [n.title, n.href]),
      (await alertEmails()).map((e) => e.data),
    ]);
    expect(text).not.toMatch(/@|\b\d{1,3}(\.\d{1,3}){3}\b|user_|Dilani/);
    expect(text).toContain("Failed sign-ins (50 in 15 minutes)");
  });

  it("OPS-06 the backup alert is silent until a first backup is recorded", async () => {
    const backup = async (at: Date) => (await currentFindings(at)).filter((f) => f.kind === "backup");
    expect(await backup(NOW)).toEqual([]);
    await recordCheckpoint("backup", "ok", NOW);
    expect(await backup(minutes(60))).toEqual([]);
    expect(await backup(minutes(27 * 60))).toEqual([
      expect.objectContaining({ measure: expect.stringMatching(/26 hours/) }),
    ]);
    await recordCheckpoint("backup", "failed", minutes(90));
    expect(await backup(minutes(91))).toEqual([expect.objectContaining({ measure: "the last backup failed" })]);
  });

  it("OPS-06 maintenance deletes counters older than 30 days", async () => {
    const realNow = new Date();
    await countEvent("server_error", new Date(realNow.getTime() - 31 * 86_400_000));
    await countEvent("server_error", realNow);
    await settleEventCounts();
    expect((await cleanUpOldRows(realNow)).opsEvents).toBe(1);
    expect(await migratorClient().opsEventCount.count()).toBe(1);
  });
});

describe("OPS-07 the Operations card", () => {
  it('OPS-07 says "Not set up yet" before any backup, and has nothing to report on a quiet day', async () => {
    const ops = await operationsOverview(user("user_admin"), NOW);
    expect(ops.backup).toEqual({ state: "not_set_up" });
    expect(ops.lastPayoutRun).toBeUndefined();
    expect(ops.lastAlert).toBeUndefined();
    expect(Object.values(ops.last24h).every((n) => n === 0)).toBe(true);
  });

  it("OPS-07 shows failed jobs, queues, last payout, backup, emails, events and the last alert", async () => {
    const c = migratorClient();
    await c.$executeRawUnsafe(
      `INSERT INTO pgboss.job (name, state, completed_on) VALUES
         ('payments.reconcile', 'failed', now()), ('payments.reconcile', 'failed', now()),
         ('email.send', 'failed', now()), ('email.send', 'failed', now() - interval '8 days'),
         ('email.send', 'created', null), ('image.process', 'retry', null)`,
    );
    const realNow = new Date();
    await recordCheckpoint("payouts", "ok", realNow);
    await recordCheckpoint("backup", "ok", realNow);
    await countEvent("sign_in_failed", realNow);
    await countEvent("payout_revealed", realNow);
    await countEvent("job_failed", realNow);
    await settleEventCounts();
    await watchOps(realNow);
    const ops = await operationsOverview(user("user_admin"), realNow);
    expect(ops.failedJobs).toEqual({
      total: 3,
      byName: [
        { name: "payments.reconcile", count: 2 },
        { name: "email.send", count: 1 },
      ],
    });
    // Waiting: the email.send above, and the one that sends the alert email just queued.
    expect(ops.queues).toEqual({ waiting: 2, retrying: 1, running: 0 });
    expect(ops.lastPayoutRun?.getTime()).toBe(realNow.getTime());
    expect(ops.backup).toEqual({ state: "ok", at: realNow });
    expect(ops.emails.queued).toBeGreaterThanOrEqual(1); // the alert email just queued
    expect(ops.last24h).toMatchObject({ sign_in_failed: 1, payout_revealed: 1, job_failed: 1 });
    expect(ops.lastAlert).toMatchObject({ kind: "job_failed", label: OPS_ALERT_RULES.job_failed.label });
  });

  it("OPS-07 counts failed alert emails, so a broken alert channel shows", async () => {
    await times("job_failed", 1);
    await watchOps(NOW);
    await migratorClient().$executeRawUnsafe(
      "UPDATE email_deliveries SET status = 'FAILED', data = NULL, to_address = NULL WHERE template = 'ops.alert'",
    );
    expect((await operationsOverview(user("user_admin"), new Date())).emails.failedAlerts).toBe(1);
  });

  it("SEC-A1 only admins get the overview", async () => {
    for (const id of ["user_customer", "user_seller"]) {
      await expect(operationsOverview(user(id), NOW)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
