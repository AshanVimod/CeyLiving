// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_RESET_HOURS } from "@/lib/config";
import { withTestStore } from "@/test/store-helpers";
import { StoreUnavailableError } from "../errors";
import { readStore, transaction } from "./dev-store";
import { DEMO_ACCOUNTS } from "./seed";

withTestStore();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
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

  it("SEC-A8 DEMO_MODE goes back to the seed after DEMO_RESET_HOURS", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_MODE", "true");
    const before = readStore().users.length;
    await transaction((db) => void db.users.pop());
    vi.advanceTimersByTime(DEMO_RESET_HOURS * 3_600_000 - 1);
    expect(readStore().users.length).toBe(before - 1);
    vi.advanceTimersByTime(1);
    expect(readStore().users.length).toBe(before);
  });
});
