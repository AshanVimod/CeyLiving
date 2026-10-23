// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_RESET_HOURS, PAYOUT_HOLD_DAYS, REVIEW_EDIT_DAYS } from "@/lib/config";
import { withTestStore } from "@/test/store-helpers";
import { StoreUnavailableError } from "../errors";
import { canPost } from "../permissions";
import { readStore, setDemoClockForTests, transaction } from "./dev-store";
import { buildSeed, DEMO_ACCOUNTS } from "./seed";

const RESET_MS = DEMO_RESET_HOURS * 3_600_000;
const DAY_MS = 86_400_000;

withTestStore();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  setDemoClockForTests(null);
});

describe("dev store", () => {
  it("seeds a file on first read with every demo account", () => {
    const data = readStore();
    expect(fs.existsSync(process.env.CEYLIVING_STORE_PATH!)).toBe(true);
    for (const account of DEMO_ACCOUNTS) expect(data.users.some((u) => u.id === account.id)).toBe(true);
  });

  it("links every seeded review to a completed order item (D-06)", () => {
    const data = readStore();
    expect(data.reviews.length).toBeGreaterThan(0);
    for (const review of data.reviews) {
      const item = data.orderItems.find((i) => i.id === review.orderItemId);
      const sellerOrder = data.sellerOrders.find((so) => so.id === item?.sellerOrderId);
      expect(sellerOrder?.status).toBe("COMPLETED");
    }
  });

  it("writes nothing when the transaction throws", async () => {
    const before = readStore().users.length;
    await expect(
      transaction((db) => {
        db.users.pop();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(readStore().users.length).toBe(before);
  });

  it("returns read-only data", () => {
    const data = readStore();
    expect(() => data.users.push(data.users[0]!)).toThrow();
  });

  it("SEC-A8 refuses writes in production and serves the read-only seed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(transaction(() => 1)).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(readStore().products.length).toBeGreaterThan(0);
  });

  it("SEC-A8 refuses writes in production when DEMO_MODE is off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "false");
    await expect(transaction(() => 1)).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("SEC-A8 DEMO_MODE keeps writes in memory and never touches the store file", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const before = readStore().users.length;
    await transaction((db) => void db.users.pop());
    expect(readStore().users.length).toBe(before - 1);
    expect(() => readStore().users.pop()).toThrow();
    expect(fs.existsSync(process.env.CEYLIVING_STORE_PATH!)).toBe(false);
  });

  it("SEC-A8 DEMO_MODE keeps nothing when the transaction throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const before = readStore().users.length;
    await expect(
      transaction((db) => {
        db.users.pop();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(readStore().users.length).toBe(before);
  });

  it("SEC-A8 DEMO_MODE starts again from the seed when the reset window changes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const windowStart = Math.floor(Date.parse("2027-03-01T08:00:00Z") / RESET_MS) * RESET_MS;
    let now = windowStart + 60_000;
    setDemoClockForTests(() => now);
    const before = readStore().users.length;
    await transaction((db) => void db.users.pop());
    now = windowStart + RESET_MS - 1;
    expect(readStore().users.length).toBe(before - 1);
    now = windowStart + RESET_MS;
    expect(readStore().users.length).toBe(before);
  });

  it("RULE-M3 / BR-11 DEMO_MODE seed dates follow the current time, so the demo accounts stay true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const now = Date.parse("2027-06-15T10:30:00Z"); // months after SEED_TIME
    setDemoClockForTests(() => now);
    const data = readStore();
    const muted = data.users.find((u) => u.id === "user_muted")!;
    expect(canPost(muted, new Date(now))).toBe(false); // "can't post for 7 days" is still true
    // The customer's latest delivery ("Has orders, one ready to review").
    const customerOrders = new Set(data.orders.filter((o) => o.customerId === "user_customer").map((o) => o.id));
    const latest = Math.max(
      ...data.sellerOrders
        .filter((so) => customerOrders.has(so.orderId) && so.completedAt)
        .map((so) => Date.parse(so.completedAt!)),
    );
    const age = now - latest;
    expect(age).toBeLessThan(PAYOUT_HOLD_DAYS * DAY_MS); // still on hold, not yet payable
    expect(age).toBeLessThan(REVIEW_EDIT_DAYS * DAY_MS);
    expect(data).toEqual(buildSeed(new Date(Math.floor(now / RESET_MS) * RESET_MS)));
  });

  it("SEC-A8 every server instance in the same window builds the same demo data", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const windowStart = Math.floor(Date.parse("2027-01-10T00:00:00Z") / RESET_MS) * RESET_MS;
    setDemoClockForTests(() => windowStart + 5 * 60_000);
    const first = structuredClone(readStore());
    setDemoClockForTests(() => windowStart + RESET_MS - 60_000); // another instance, later in the window
    expect(readStore()).toEqual(first);
  });
});
