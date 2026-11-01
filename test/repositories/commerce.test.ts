// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as commerceRepo from "@/lib/server/repositories/commerce";
import { ConflictError } from "@/lib/server/errors";
import { buildSeed, type SeedData } from "@/prisma/seed-data";
import type { CustomRequest, Payout, SellerOrder } from "@/lib/types";
import { byId, repositoryBackend } from "./backends";

// Orders, seller orders, order items, payouts and custom requests: the same suite on both backends, then what only
// PostgreSQL guarantees.

const { backends, pg } = await repositoryBackend(commerceRepo);

/** Seller orders and items in a fixed order, so lists whose order isn't specified compare equal. */
const sorted = (order: commerceRepo.OrderWithParts) => ({
  order: order.order,
  sellerOrders: byId(order.sellerOrders.map((p) => ({ ...p, id: p.sellerOrder.id }))).map(({ sellerOrder, items }) => ({
    sellerOrder,
    items: byId(items),
  })),
});

const newestFirstBy = <T>(rows: T[], key: (row: T) => string) =>
  rows.every((row, i) => i === 0 || key(rows[i - 1]) >= key(row));

function payoutFor(shopId: string, orders: SellerOrder[], id = "payout_test"): Payout {
  const gross = orders.reduce((sum, so) => sum + so.subtotalCents + so.shippingCents, 0);
  return {
    id,
    shopId,
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-07T23:59:59.000Z",
    sellerOrderIds: orders.map((so) => so.id),
    grossCents: gross,
    commissionCents: 0,
    refundsCents: 0,
    netCents: gross,
    status: "SCHEDULED",
    createdAt: "2026-10-08T06:00:00.000Z",
  };
}

function request(id: string, shopId: string, updatedAt: string): CustomRequest {
  return {
    id,
    customerId: "user_customer",
    customerName: "Test Customer",
    shopId,
    message: "A mask in my family's colours, please.",
    budgetCents: 1_500_000,
    status: "OPEN",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt,
  };
}

for (const [name, backend] of backends) {
  describe(`commerce repository contract: ${name}`, () => {
    const { repo, db, withTx, reset } = backend!;
    let seed: SeedData;
    let completed: SellerOrder;
    beforeEach(async () => {
      seed = await reset();
      completed = seed.sellerOrders.find((so) => so.status === "COMPLETED" && !so.payoutId)!;
    });

    it("BE-01 returns a customer's orders newest first, each with its seller orders and items", async () => {
      const mine = await repo.ordersOfCustomer(db, "user_customer");
      const expected = seed.orders.filter((o) => o.customerId === "user_customer");
      expect(mine.length).toBe(expected.length);
      expect(newestFirstBy(mine, (o) => o.order.placedAt)).toBe(true);
      for (const order of mine) {
        const sellerOrders = seed.sellerOrders.filter((so) => so.orderId === order.order.id);
        expect(sorted(order)).toEqual(
          sorted({
            order: seed.orders.find((o) => o.id === order.order.id)!,
            sellerOrders: sellerOrders.map((so) => ({
              sellerOrder: so,
              items: seed.orderItems.filter((i) => i.sellerOrderId === so.id),
            })),
          }),
        );
      }
      expect(byId(await repo.listOrdersOfCustomer(db, "user_customer"))).toEqual(byId(expected));
      const first = mine[0];
      expect(sorted((await repo.findOrderByNumber(db, first.order.orderNumber))!)).toEqual(sorted(first));
      expect(await repo.findOrderByNumber(db, "CL-NOPE")).toBeUndefined();
      expect(await repo.findOrderById(db, first.order.id)).toEqual(first.order);
    });

    it("SEC-A5 a shop sees only its own seller orders; another shop's order looks missing", async () => {
      const so = seed.sellerOrders[0];
      const otherShop = seed.shops.find((s) => s.id !== so.shopId)!;
      expect(await repo.findSellerOrderForShop(db, so.id, so.shopId)).toEqual(so);
      expect(await repo.findSellerOrderForShop(db, so.id, otherShop.id)).toBeUndefined();
      const ofShop = await repo.sellerOrdersOfShop(db, so.shopId);
      expect(ofShop.every((row) => row.shopId === so.shopId)).toBe(true);
      expect(newestFirstBy(ofShop, (row) => row.updatedAt)).toBe(true);
      expect(byId(await repo.sellerOrdersOfCustomer(db, "user_customer"))).toEqual(
        byId(
          seed.sellerOrders.filter((row) =>
            seed.orders.some((o) => o.id === row.orderId && o.customerId === "user_customer"),
          ),
        ),
      );
      expect(await repo.orderOfSellerOrder(db, so)).toEqual(seed.orders.find((o) => o.id === so.orderId));
    });

    it("BE-01 returns order items by seller order and by id", async () => {
      const so = seed.sellerOrders[0];
      const items = seed.orderItems.filter((i) => i.sellerOrderId === so.id);
      expect(byId(await repo.itemsOfSellerOrder(db, so.id))).toEqual(byId(items));
      const ids = seed.sellerOrders.slice(0, 2).map((row) => row.id);
      expect(byId(await repo.itemsOfSellerOrders(db, ids))).toEqual(
        byId(seed.orderItems.filter((i) => ids.includes(i.sellerOrderId))),
      );
      expect(await repo.findOrderItem(db, items[0].id)).toEqual(items[0]);
    });

    it("DB-06 a seller order moves on only from the status it is still in", async () => {
      const fresh = seed.sellerOrders.find((so) => so.status === "NEW")!;
      const accepted = await withTx((tx) =>
        repo.updateSellerOrder(
          tx,
          fresh.id,
          { status: "ACCEPTED", acceptedAt: "2026-10-20T10:00:00.000Z" },
          { from: "NEW" },
        ),
      );
      expect(accepted).toMatchObject({ status: "ACCEPTED", acceptedAt: "2026-10-20T10:00:00.000Z" });
      expect(
        await withTx((tx) => repo.updateSellerOrder(tx, fresh.id, { status: "CANCELLED" }, { from: "NEW" })),
      ).toBeUndefined();
      const tracked = await withTx((tx) =>
        repo.updateSellerOrder(tx, fresh.id, { courierName: "Pronto", trackingRef: undefined }),
      );
      expect(tracked?.courierName).toBe("Pronto");
      expect(tracked?.trackingRef).toBeUndefined();
      expect(await repo.findSellerOrder(db, fresh.id)).toEqual(tracked);
    });

    it("BR-11 lists delivered orders not yet paid out, and a payout links them once", async () => {
      const unpaid = await repo.unpaidCompletedSellerOrders(db);
      expect(byId(unpaid)).toEqual(byId(seed.sellerOrders.filter((so) => so.status === "COMPLETED" && !so.payoutId)));
      const ofShop = await repo.unpaidCompletedSellerOrders(db, completed.shopId);
      expect(ofShop.every((so) => so.shopId === completed.shopId)).toBe(true);

      const payout = payoutFor(completed.shopId, ofShop);
      await withTx(async (tx) => {
        await repo.insertPayout(tx, payout);
        await repo.setPayoutOnSellerOrders(tx, payout.sellerOrderIds, payout.id);
      });
      expect(await repo.unpaidCompletedSellerOrders(db, completed.shopId)).toEqual([]);
      const stored = (await repo.findPayout(db, payout.id))!;
      expect({ ...stored, sellerOrderIds: [...stored.sellerOrderIds].sort() }).toEqual({
        ...payout,
        sellerOrderIds: [...payout.sellerOrderIds].sort(),
      });
      expect((await repo.findSellerOrder(db, completed.id))?.payoutId).toBe(payout.id);
      expect((await repo.payoutsOfShop(db, completed.shopId)).map((p) => p.id)).toContain(payout.id);
      expect((await repo.listPayouts(db)).map((p) => p.id)).toContain(payout.id);
    });

    it("DB-06 a payout is marked paid only while it is still scheduled", async () => {
      const payout = payoutFor(completed.shopId, [completed]);
      await withTx(async (tx) => {
        await repo.insertPayout(tx, payout);
        await repo.setPayoutOnSellerOrders(tx, payout.sellerOrderIds, payout.id);
      });
      const paid = await withTx((tx) =>
        repo.updatePayout(
          tx,
          payout.id,
          { status: "PAID", paidAt: "2026-10-09T10:00:00.000Z", reference: "TRX-1" },
          {
            from: "SCHEDULED",
          },
        ),
      );
      expect(paid).toMatchObject({ status: "PAID", reference: "TRX-1", sellerOrderIds: [completed.id] });
      expect(
        await withTx((tx) =>
          repo.updatePayout(tx, payout.id, { status: "PAID", reference: "TRX-2" }, { from: "SCHEDULED" }),
        ),
      ).toBeUndefined();
      expect((await repo.findPayout(db, payout.id))?.reference).toBe("TRX-1");
    });

    it("BR-11 lists payouts newest first", async () => {
      const [a, b] = [
        { ...payoutFor(completed.shopId, [], "payout_old"), createdAt: "2026-10-01T06:00:00.000Z" },
        { ...payoutFor(completed.shopId, [], "payout_new"), createdAt: "2026-10-08T06:00:00.000Z" },
      ];
      await withTx(async (tx) => {
        await repo.insertPayout(tx, a);
        await repo.insertPayout(tx, b);
      });
      const ids = (await repo.payoutsOfShop(db, completed.shopId)).map((p) => p.id);
      expect(ids.indexOf("payout_new")).toBeLessThan(ids.indexOf("payout_old"));
      expect(newestFirstBy(await repo.listPayouts(db), (p) => p.createdAt)).toBe(true);
    });

    it("FR-14 stores a custom request with its quote, lists it most recently updated first, and clears a field", async () => {
      const shopId = seed.shops[0].id;
      await withTx(async (tx) => {
        await repo.insertCustomRequest(tx, request("req_old", shopId, "2026-10-02T10:00:00.000Z"));
        await repo.insertCustomRequest(tx, request("req_new", shopId, "2026-10-03T10:00:00.000Z"));
      });
      const quote = { priceCents: 1_800_000, days: 21, message: "Happy to.", quotedAt: "2026-10-04T10:00:00.000Z" };
      const quoted = await withTx((tx) =>
        repo.updateCustomRequest(tx, "req_old", {
          status: "QUOTED",
          quote,
          budgetCents: undefined,
          updatedAt: quote.quotedAt,
        }),
      );
      expect(quoted).toMatchObject({ status: "QUOTED", quote });
      expect(quoted?.budgetCents).toBeUndefined();
      expect(await repo.findCustomRequest(db, "req_old")).toEqual(quoted);
      expect(await withTx((tx) => repo.updateCustomRequest(tx, "req_nobody", { status: "DECLINED" }))).toBeUndefined();

      const ofShop = (await repo.customRequestsOfShop(db, shopId)).map((r) => r.id);
      expect(ofShop.indexOf("req_old")).toBeLessThan(ofShop.indexOf("req_new"));
      const mine = await repo.customRequestsOfCustomer(db, "user_customer");
      expect(newestFirstBy(mine, (r) => r.updatedAt)).toBe(true);
    });

    it("FR-17 account deletion blanks the customer's name on requests and orders' shipping addresses", async () => {
      const shopId = seed.shops[0].id;
      await withTx((tx) => repo.insertCustomRequest(tx, request("req_x", shopId, "2026-10-02T10:00:00.000Z")));
      await withTx(async (tx) => {
        await repo.renameCustomerOnRequests(tx, "user_customer", "Former customer");
        for (const order of await repo.listOrdersOfCustomer(tx, "user_customer")) {
          await repo.updateOrder(tx, order.id, {
            shippingAddress: { ...order.shippingAddress, recipientName: "Former customer", phone: "" },
          });
        }
      });
      expect((await repo.findCustomRequest(db, "req_x"))?.customerName).toBe("Former customer");
      const orders = await repo.listOrdersOfCustomer(db, "user_customer");
      expect(orders.length).toBeGreaterThan(0);
      expect(
        orders.every((o) => o.shippingAddress.recipientName === "Former customer" && o.shippingAddress.phone === ""),
      ).toBe(true);
      const before = seed.orders.find((o) => o.id === orders[0].id)!;
      expect(orders[0].shippingAddress.city).toBe(before.shippingAddress.city);
      expect(orders[0].totalCents).toBe(before.totalCents);
    });

    it("BE-03 the shared read handle refuses writes", async () => {
      await expect(repo.renameCustomerOnRequests(db, "user_customer", "x")).rejects.toThrow("withTx");
    });
  });
}

describe("commerce (PostgreSQL only)", () => {
  const { handles, appUrl } = pg;
  let seed: SeedData;
  let completed: SellerOrder;
  beforeEach(async () => {
    seed = buildSeed(new Date());
    await pg.reset(seed);
    completed = seed.sellerOrders.find((so) => so.status === "COMPLETED" && !so.payoutId)!;
  });

  /** One payout run as the payout service does it: read unpaid orders, store a payout, link the orders. */
  const payoutRun = (id: string, handlesToUse = handles) =>
    handlesToUse.withTx(async (tx) => {
      const orders = await commerceRepo.unpaidCompletedSellerOrders(tx, completed.shopId);
      if (!orders.length) return undefined;
      const payout = payoutFor(completed.shopId, orders, id);
      await commerceRepo.insertPayout(tx, payout);
      await new Promise((resolve) => setTimeout(resolve, 200)); // both runs read before either links
      await commerceRepo.setPayoutOnSellerOrders(tx, payout.sellerOrderIds, payout.id);
      return payout;
    });

  it("BR-11 / DB-06 two payout runs at the same moment pay each order once; the loser rolls back", async () => {
    // A second connection pool, so the two runs really run side by side.
    const { createPrismaClient, handlesFor } = await import("@/lib/server/db/tx");
    const other = createPrismaClient(appUrl);
    try {
      const results = await Promise.allSettled([
        payoutRun("payout_a"),
        payoutRun(
          "payout_b",
          handlesFor(() => other),
        ),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toBeInstanceOf(ConflictError);

      const payouts = await commerceRepo.payoutsOfShop(handles.db, completed.shopId);
      expect(payouts).toHaveLength(1);
      expect(payouts[0].sellerOrderIds).toContain(completed.id);
    } finally {
      await other.$disconnect();
    }
  });

  it("BR-11 linking orders to the payout they already belong to is harmless", async () => {
    const payout = (await payoutRun("payout_once"))!;
    await handles.withTx((tx) => commerceRepo.setPayoutOnSellerOrders(tx, payout.sellerOrderIds, payout.id));
    expect((await commerceRepo.findPayout(handles.db, payout.id))?.sellerOrderIds.sort()).toEqual(
      [...payout.sellerOrderIds].sort(),
    );
  });

  it("DB-07 the database refuses a total that doesn't add up, a quantity of 21 and a period that ends first", async () => {
    const order = seed.orders[0];
    await expect(
      handles.withTx((tx) => commerceRepo.updateOrder(tx, order.id, { totalCents: order.totalCents + 1 })),
    ).rejects.toThrow();
    const item = seed.orderItems[0];
    await expect(pg.app.$executeRaw`UPDATE order_items SET quantity = 21 WHERE id = ${item.id}`).rejects.toThrow(
      /check constraint/,
    );
    const backwards = { ...payoutFor(completed.shopId, []), periodEnd: "2026-09-01T00:00:00.000Z" };
    await expect(handles.withTx((tx) => commerceRepo.insertPayout(tx, backwards))).rejects.toThrow();
  });
});
