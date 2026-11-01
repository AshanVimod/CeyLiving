// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS } from "@/lib/server/demo-accounts";
import { buildSeed } from "./seed-data";

// The demo data's own promises, kept from the dev store's tests when it was removed in B04a.

describe("demo data (feature spec 7.5)", () => {
  const data = buildSeed(new Date("2026-10-22T06:00:00.000Z"));

  it("has every demo account offered on /signin", () => {
    for (const account of DEMO_ACCOUNTS) expect(data.users.some((u) => u.id === account.id)).toBe(true);
  });

  it("D-06 links every seeded review to a completed order item", () => {
    expect(data.reviews.length).toBeGreaterThan(0);
    for (const review of data.reviews) {
      const item = data.orderItems.find((i) => i.id === review.orderItemId);
      const sellerOrder = data.sellerOrders.find((so) => so.id === item?.sellerOrderId);
      expect(sellerOrder?.status).toBe("COMPLETED");
    }
  });

  it("gives every product a shop that exists and every shop an owner that exists", () => {
    const shops = new Set(data.shops.map((s) => s.slug));
    const users = new Set(data.users.map((u) => u.id));
    expect(data.products.every((p) => shops.has(p.shopSlug))).toBe(true);
    expect(data.shops.every((s) => users.has(s.ownerId))).toBe(true);
  });
});
