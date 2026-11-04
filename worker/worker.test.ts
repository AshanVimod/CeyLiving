// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { JobHandler } from "@/lib/server/observability/job";
import { reportContent } from "@/lib/server/services/moderation";
import { queuedJobs, readAll, user, withTestDatabase } from "@/test/db";
import { captureLogger } from "@/test/log-capture";
import { HANDLERS } from "./handlers";
import { startWorker, type RunningWorker } from "./worker";

// B06: real pg-boss workers on this file's database, as `npm run worker` runs them (two at once where it matters).

withTestDatabase();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out waiting for the worker");
    await sleep(200);
  }
}

const running: RunningWorker[] = [];
const original = HANDLERS["maintenance.cleanup"];

/** A worker that checks schedules and polls every second (production uses pg-boss's defaults). */
async function worker() {
  const started = await startWorker({
    connectionString: process.env.DATABASE_URL!,
    log: captureLogger().logger,
    concurrency: 2,
    boss: { cronMonitorIntervalSeconds: 1, cronWorkerIntervalSeconds: 1 },
  });
  running.push(started);
  return started;
}

/** Swaps the maintenance.cleanup handler for this test (restored afterwards). */
function useCleanupHandler(handler: JobHandler<"maintenance.cleanup">) {
  HANDLERS["maintenance.cleanup"] = handler;
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((w) => w.stop(1_000)));
  HANDLERS["maintenance.cleanup"] = original;
});

const jobStates = async (name: string) => (await queuedJobs(name)).map((j) => j.state);

describe("the worker (JOB-02, JOB-04, JOB-05, JOB-07)", () => {
  it("JOB-05 two workers run one schedule tick once", async () => {
    let runs = 0;
    useCleanupHandler(async () => {
      runs++;
    });
    const [a] = await Promise.all([worker(), worker()]);
    // pg-boss files a schedule's ticks in one-minute slots; keep the whole test inside one minute.
    if (new Date().getSeconds() > 30) await sleep((61 - new Date().getSeconds()) * 1000);
    // A tick every 2 seconds: each worker sees about five of them, yet the minute's slot holds one job.
    await a!.boss.schedule("maintenance.cleanup", "*/2 * * * * *", {}, { tz: "UTC" });
    await sleep(10_000);
    await a!.boss.unschedule("maintenance.cleanup");
    await until(async () => (await jobStates("maintenance.cleanup")).every((s) => s === "completed"));
    expect(await jobStates("maintenance.cleanup")).toEqual(["completed"]);
    expect(runs).toBe(1);
  }, 90_000);

  it("JOB-05 every scheduled job is registered once, in Sri Lankan time, however many workers start", async () => {
    const [a] = await Promise.all([worker(), worker()]);
    const schedules = await a!.boss.getSchedules();
    expect(schedules.map((s) => s.name).sort()).toEqual([
      "customRequests.expire",
      "email.watch",
      "maintenance.cleanup",
      "orders.autoCancelUnaccepted",
      "orders.autoComplete",
      "payments.reconcile",
      "payouts.generateWeekly",
      "users.liftExpiredMutes",
    ]);
    expect(schedules.find((s) => s.name === "payouts.generateWeekly")).toMatchObject({
      cron: "0 6 * * 1",
      timezone: "Asia/Colombo",
    });
  });

  it("JOB-02 a report's auto-hide job is picked up by the worker", async () => {
    await worker();
    const input = { targetType: "QUESTION" as const, targetId: "q_naga_size", reason: "Offensive or abusive" as const };
    for (const id of ["user_muted", "user_applicant", "user_seller"]) await reportContent(user(id), input);
    await until(async () => (await readAll()).questions.find((q) => q.id === "q_naga_size")!.status === "HIDDEN");
    // pg-boss marks the job completed just after the handler's transaction commits, so wait for that too.
    await until(async () => (await jobStates("reports.autoHide"))[0] === "completed");
    expect(await jobStates("reports.autoHide")).toEqual(["completed"]);
  });

  it("JOB-04 a failing job is retried, kept as failed after its last try, and the admins are told", async () => {
    let tries = 0;
    useCleanupHandler(async () => {
      tries++;
      throw new Error("still failing");
    });
    const w = await worker();
    // Production waits 30 seconds and up; one retry a second apart keeps the test short.
    await w.boss.send("maintenance.cleanup", {}, { retryLimit: 1, retryDelay: 1, retryBackoff: false });
    await until(async () => (await jobStates("maintenance.cleanup"))[0] === "failed");
    expect(tries).toBe(2);
    const alerts = (await readAll()).notifications.filter((n) => n.type === "job.failed");
    expect(alerts.map((n) => n.userId)).toEqual(["user_admin"]);
  });

  it("JOB-07 stopping waits for the running job to finish", async () => {
    let started = false;
    let finished = false;
    useCleanupHandler(async () => {
      started = true;
      await sleep(1_500);
      finished = true;
    });
    const w = await worker();
    await w.boss.send("maintenance.cleanup", {});
    await until(() => started);
    await w.stop();
    running.splice(running.indexOf(w), 1);
    expect(finished).toBe(true);
    expect(await jobStates("maintenance.cleanup")).toEqual(["completed"]);
  });

  it("JOB-07 stopping gives up after the time limit; the unfinished job stays for a later retry", async () => {
    let started = false;
    useCleanupHandler(async () => {
      started = true;
      await sleep(10_000);
    });
    const w = await worker();
    await w.boss.send("maintenance.cleanup", {});
    await until(() => started);
    const t0 = Date.now();
    await w.stop(500);
    running.splice(running.indexOf(w), 1);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(await jobStates("maintenance.cleanup")).not.toEqual(["completed"]);
  });
});
