// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CUSTOM_REQUEST_EXPIRY_DAYS } from "@/lib/config";
import { withTx } from "@/lib/server/db/tx";
import { ConflictError } from "@/lib/server/errors";
import { RETRY_POLICY } from "@/lib/server/jobs/queues";
import { runJob } from "@/lib/server/observability/job";
import { enqueue } from "@/lib/server/repositories/jobs";
import { quoteCustomRequest } from "@/lib/server/services/custom-requests";
import { reportContent } from "@/lib/server/services/moderation";
import { AUTO_CANCEL_REASON } from "@/lib/server/services/orders";
import { commissionFor, generatePayouts, runPayouts } from "@/lib/server/services/payouts";
import { inBatches, WORKER } from "@/lib/server/services/shared";
import type { SellerOrder } from "@/lib/types";
import { changeData, queuedJobs, readAll, user, withTestDatabase } from "@/test/db";
import { runJobNow } from "@/test/jobs";
import { captureLogger } from "@/test/log-capture";

// B06: every job in backend plan 10.2. Each runs twice (JOB-03): the second run must change nothing.

withTestDatabase();

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** The demo customer's seller order in `status` (the seed has one NEW and one DISPATCHED). */
async function customerOrder(status: SellerOrder["status"]): Promise<SellerOrder> {
  const db = await readAll();
  const orderIds = new Set(db.orders.filter((o) => o.customerId === "user_customer").map((o) => o.id));
  return db.sellerOrders.find((so) => orderIds.has(so.orderId) && so.status === status)!;
}

const sellerOrder = async (id: string) => (await readAll()).sellerOrders.find((so) => so.id === id)!;
const notificationsOfType = async (type: string) => (await readAll()).notifications.filter((n) => n.type === type);

describe("orders.autoCancelUnaccepted (BR-08)", () => {
  it("JOB-03 BR-08 cancels NEW orders past their accept deadline once, telling the customer and the maker", async () => {
    const overdue = await customerOrder("NEW");
    await changeData((db) => {
      db.sellerOrders.find((so) => so.id === overdue.id)!.acceptDeadlineAt = daysAgo(1);
    });

    await runJobNow("orders.autoCancelUnaccepted");
    await runJobNow("orders.autoCancelUnaccepted");

    const after = await sellerOrder(overdue.id);
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toBe(AUTO_CANCEL_REASON);
    const told = (await notificationsOfType("order.cancelled")).map((n) => n.userId).sort();
    expect(told).toEqual(["user_customer", "user_seller"]); // once each, not twice
  });

  it("BR-08 leaves orders with a future deadline, no deadline, or already accepted", async () => {
    const order = await customerOrder("NEW");
    await runJobNow("orders.autoCancelUnaccepted"); // no deadline set (NULL): never cancelled
    expect((await sellerOrder(order.id)).status).toBe("NEW");
    await changeData((db) => {
      db.sellerOrders.find((so) => so.id === order.id)!.acceptDeadlineAt = new Date(Date.now() + DAY).toISOString();
    });
    await runJobNow("orders.autoCancelUnaccepted");
    expect((await sellerOrder(order.id)).status).toBe("NEW");
    await changeData((db) => {
      Object.assign(
        db.sellerOrders.find((so) => so.id === order.id)!,
        { status: "ACCEPTED", acceptDeadlineAt: daysAgo(1) },
      );
    });
    await runJobNow("orders.autoCancelUnaccepted");
    expect((await sellerOrder(order.id)).status).toBe("ACCEPTED");
  });
});

describe("orders.autoComplete (BR-17)", () => {
  it("JOB-03 BR-17 completes orders dispatched over 7 days ago once; newer ones wait", async () => {
    const old = await customerOrder("DISPATCHED");
    await changeData((db) => {
      db.sellerOrders.find((so) => so.id === old.id)!.dispatchedAt = daysAgo(8);
    });
    await runJobNow("orders.autoComplete");
    await runJobNow("orders.autoComplete");
    const after = await sellerOrder(old.id);
    expect(after.status).toBe("COMPLETED");
    expect(Date.now() - Date.parse(after.completedAt!)).toBeLessThan(60_000);
    expect(await notificationsOfType("order.completed")).toHaveLength(1);

    await changeData((db) => {
      Object.assign(
        db.sellerOrders.find((so) => so.id === old.id)!,
        { status: "DISPATCHED", dispatchedAt: daysAgo(6) },
      );
    });
    await runJobNow("orders.autoComplete");
    expect((await sellerOrder(old.id)).status).toBe("DISPATCHED");
  });
});

describe("payouts.generateWeekly (BR-11)", () => {
  it("JOB-03 BR-11 a repeated or retried weekly run never pays an order twice", async () => {
    await runJobNow("payouts.generateWeekly");
    const first = await readAll();
    expect(first.payouts.length).toBeGreaterThan(0);
    await runJobNow("payouts.generateWeekly");
    const second = await readAll();
    expect(second.payouts).toHaveLength(first.payouts.length);
    // The worker's runs are audited with no person as the actor, and say which job did it.
    const entries = second.auditLog.filter((a) => a.action === "payout.generated");
    expect(entries).toHaveLength(first.payouts.length);
    expect(entries.every((a) => a.actorId === undefined && a.reason?.includes("payouts.generateWeekly"))).toBe(true);
  });

  it("BR-11 the admin button still works and is audited with the admin's name", async () => {
    const created = await generatePayouts(user("user_admin"));
    expect(created.length).toBeGreaterThan(0);
    const db = await readAll();
    for (const p of created) {
      const orders = db.sellerOrders.filter((so) => so.payoutId === p.id);
      expect(orders.map((so) => so.id).sort()).toEqual([...p.sellerOrderIds].sort());
      expect(p.netCents).toBe(orders.reduce((s, so) => s + so.subtotalCents + so.shippingCents - commissionFor(so), 0));
    }
    expect(db.auditLog.filter((a) => a.action === "payout.generated").every((a) => a.actorId === "user_admin")).toBe(
      true,
    );
  });

  it("BR-11 DB-06 the admin button and the weekly job at the same moment pay each order exactly once", async () => {
    const results = await Promise.all([
      generatePayouts(user("user_admin")),
      runPayouts(WORKER),
      generatePayouts(user("user_admin")),
      runPayouts(WORKER),
    ]);
    const db = await readAll();
    const made = results.flat();
    // Every payout that a run reported is in the database, and no seller order belongs to two of them.
    expect(db.payouts.map((p) => p.id).sort()).toEqual(made.map((p) => p.id).sort());
    const ids = db.payouts.flatMap((p) => p.sellerOrderIds);
    expect(new Set(ids).size).toBe(ids.length);
    // One payout per shop, as one run alone would make.
    expect(new Set(db.payouts.map((p) => p.shopId)).size).toBe(db.payouts.length);
    for (const so of db.sellerOrders.filter((s) => s.payoutId))
      expect(db.payouts.find((p) => p.id === so.payoutId)!.sellerOrderIds).toContain(so.id);
  });
});

describe("customRequests.expire (FR-14)", () => {
  const stale = (id: string, status: "OPEN" | "QUOTED", days = CUSTOM_REQUEST_EXPIRY_DAYS + 1) => ({
    id,
    customerId: "user_customer",
    customerName: "Demo Customer",
    shopId: "shop_rata-studio",
    message: "A carved name board for our front door, about 60 cm wide.",
    status,
    createdAt: daysAgo(days),
    updatedAt: daysAgo(days),
  });

  it("JOB-03 FR-14 expires open requests and unanswered quotes after 14 days, once; fresh ones stay", async () => {
    await changeData((db) => {
      db.customRequests.push(
        stale("req_old_open", "OPEN"),
        stale("req_old_quoted", "QUOTED"),
        stale("req_new", "OPEN", 2),
      );
    });
    await runJobNow("customRequests.expire");
    await runJobNow("customRequests.expire");
    const byId = new Map((await readAll()).customRequests.map((r) => [r.id, r.status]));
    expect(Object.fromEntries(byId)).toEqual({ req_old_open: "EXPIRED", req_old_quoted: "EXPIRED", req_new: "OPEN" });
    expect(await notificationsOfType("request.expired")).toHaveLength(2);
  });

  it("FR-14 a request gone stale before the job runs still can't be quoted", async () => {
    await changeData((db) => {
      db.customRequests.push(stale("req_stale", "OPEN"));
    });
    await expect(
      quoteCustomRequest(user("user_owner_rata-studio"), { requestId: "req_stale", price: 100_000, days: 3 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("JOB-06 works through many rows in batches of 100 and finishes them all", async () => {
    await changeData((db) => {
      for (let i = 0; i < 250; i++) db.customRequests.push(stale(`req_bulk_${String(i).padStart(3, "0")}`, "OPEN"));
    });
    const lines = await runJobNow("customRequests.expire");
    expect(lines.find((l) => l.msg === "job.completed")).toMatchObject({ expired: 250 });
    expect((await readAll()).customRequests.filter((r) => r.status === "EXPIRED")).toHaveLength(250);
  });

  it("JOB-06 inBatches asks for 100 rows at a time and stops at the first short batch", async () => {
    const asked: number[] = [];
    const handled = [100, 100, 50];
    expect(await inBatches(async (limit) => (asked.push(limit), handled[asked.length - 1]!))).toBe(250);
    expect(asked).toEqual([100, 100, 100]);
  });
});

describe("users.liftExpiredMutes (RULE-M3)", () => {
  it("JOB-03 RULE-M3 lifts mutes that have ended once, with one audit row; running mutes stay", async () => {
    await changeData((db) => {
      db.users.find((u) => u.id === "user_muted")!.mutedUntil = daysAgo(1);
    });
    await runJobNow("users.liftExpiredMutes");
    await runJobNow("users.liftExpiredMutes");
    const db = await readAll();
    const muted = db.users.find((u) => u.id === "user_muted")!;
    expect(muted).toMatchObject({ postingRestriction: "NONE", mutedUntil: undefined, restrictionReason: undefined });
    const audits = db.auditLog.filter((a) => a.action === "user.mute_expired");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: undefined, targetId: "user_muted" });
    expect(db.notifications.filter((n) => n.userId === "user_muted" && n.type === "user.lift")).toHaveLength(1);
  });

  it("RULE-M3 a mute that hasn't ended is left alone", async () => {
    await runJobNow("users.liftExpiredMutes"); // the seed mutes user_muted for 7 more days
    expect((await readAll()).users.find((u) => u.id === "user_muted")!.postingRestriction).toBe("MUTED");
  });
});

describe("reports.autoHide (RULE-M4)", () => {
  const input = { targetType: "QUESTION" as const, targetId: "q_naga_size", reason: "Offensive or abusive" as const };

  it("JOB-03 RULE-M4 hides heavily reported content once, with one audit row", async () => {
    for (const id of ["user_muted", "user_applicant", "user_seller"]) await reportContent(user(id), input);
    const payload = { targetType: "QUESTION", targetId: "q_naga_size" } as const;
    await runJobNow("reports.autoHide", payload);
    await runJobNow("reports.autoHide", payload);
    const db = await readAll();
    expect(db.questions.find((q) => q.id === "q_naga_size")!.status).toBe("HIDDEN");
    expect(db.auditLog.filter((a) => a.action === "content.auto_hidden")).toHaveLength(1);
  });

  it("RULE-M4 one queued check per post, however many more reports arrive before it runs", async () => {
    for (const id of ["user_muted", "user_applicant", "user_seller", "user_customer"])
      await reportContent(user(id), input);
    expect(await queuedJobs("reports.autoHide")).toHaveLength(1);
  });

  it("RULE-M4 a check for content under the threshold changes nothing", async () => {
    await runJobNow("reports.autoHide", { targetType: "QUESTION", targetId: "q_naga_size" });
    expect((await readAll()).questions.find((q) => q.id === "q_naga_size")!.status).toBe("VISIBLE");
  });
});

describe("maintenance.cleanup", () => {
  it("JOB-03 deletes rate events older than a day, once; recent ones stay", async () => {
    await changeData((db) => {
      db.rateEvents.push(
        { userId: "user_customer", kind: "review", at: daysAgo(2) },
        { userId: "user_customer", kind: "review", at: new Date().toISOString() },
      );
    });
    await runJobNow("maintenance.cleanup");
    const lines = await runJobNow("maintenance.cleanup");
    expect((await readAll()).rateEvents).toHaveLength(1);
    expect(lines.find((l) => l.msg === "job.completed")).toMatchObject({ deleted: { rateEvents: 0 } });
  });
});

describe("jobs for missing rows, and reconciliation without the PayHere API", () => {
  it("JOB-03 PAY-08 email.send and image.process for unknown ids, and payments.reconcile (no Merchant API key), change nothing", async () => {
    const before = await readAll();
    for (let run = 0; run < 2; run++) {
      await runJobNow("email.send", { deliveryId: "eml_missing" });
      await runJobNow("image.process", { uploadId: "upload_x" });
      await runJobNow("payments.reconcile");
    }
    expect(await readAll()).toEqual(before);
  });
});

describe("enqueue and failures (JOB-02, JOB-04)", () => {
  const payload = { targetType: "QUESTION", targetId: "q_naga_size" } as const;

  it("JOB-02 a job enqueued in a transaction that rolls back never exists", async () => {
    await expect(
      withTx(async (tx) => {
        await enqueue(tx, "reports.autoHide", payload);
        throw new Error("the business change failed");
      }),
    ).rejects.toThrow("the business change failed");
    expect(await queuedJobs("reports.autoHide")).toEqual([]);
    await withTx((tx) => enqueue(tx, "reports.autoHide", payload));
    expect(await queuedJobs("reports.autoHide")).toHaveLength(1);
  });

  it("JOB-02 refuses a payload that doesn't match the job's schema", async () => {
    await expect(
      withTx((tx) => enqueue(tx, "reports.autoHide", { targetType: "PRODUCT", targetId: "p" } as never)),
    ).rejects.toThrow();
  });

  it("JOB-04 a failed try is logged and rethrown for a retry; the last one also alerts the admins", async () => {
    const { logger, lines } = captureLogger();
    const failing = async () => {
      throw new Error("provider down");
    };
    const job = (retryCount: number) => ({
      id: `job_${retryCount}`,
      name: "maintenance.cleanup",
      data: {},
      retryCount,
      retryLimit: 4,
    });

    await expect(runJob("maintenance.cleanup", job(0), failing, logger)).rejects.toThrow("provider down");
    expect(lines.at(-1)).toMatchObject({ level: "error", msg: "job.retrying", attempt: 1, final: false });
    expect(await notificationsOfType("job.failed")).toEqual([]);

    await expect(runJob("maintenance.cleanup", job(4), failing, logger)).rejects.toThrow("provider down");
    expect(lines.at(-1)).toMatchObject({ level: "error", msg: "job.failed", attempt: 5, final: true });
    expect((await notificationsOfType("job.failed")).map((n) => n.userId)).toEqual(["user_admin"]);
  });

  it("JOB-04 five tries in all, starting 30 seconds apart and backing off", () => {
    expect(RETRY_POLICY).toMatchObject({ retryLimit: 4, retryDelay: 30, retryBackoff: true });
  });

  it("JOB-01 a payload that fails its schema is recorded and alerted, not retried forever", async () => {
    const lines = await runJobNow("reports.autoHide", { targetType: "SHOP", targetId: "" } as never);
    expect(lines.at(-1)).toMatchObject({ level: "error", msg: "job.invalid_payload" });
    expect(await notificationsOfType("job.failed")).toHaveLength(1);
  });
});
