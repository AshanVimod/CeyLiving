// @vitest-environment node
import { describe, expect, it } from "vitest";
import { user, withTestStore } from "@/test/store-helpers";
import { ConflictError } from "../errors";
import { findShopByOwner, findShopBySlug, updateShop } from "../repositories/catalogue";
import { findSellerOrder, updateSellerOrder } from "../repositories/commerce";
import { addNotification, notificationsOf } from "../repositories/people";
import { transitionSellerOrder } from "../services/orders";
import { readStore } from "../store/dev-store";
import { db, withTx } from "./tx";

withTestStore();

const newOrderOf = (shopId: string) =>
  readStore().sellerOrders.find((so) => so.shopId === shopId && so.status === "NEW")!;

describe("transaction handle (backend plan 6.1)", () => {
  it("DB-04 withTx writes nothing when a step fails", async () => {
    const before = readStore().notifications.length;
    await expect(
      withTx(async (tx) => {
        await addNotification(tx, "user_customer", "test", "First write", "/");
        throw new Error("second step failed");
      }),
    ).rejects.toThrow("second step failed");
    expect(readStore().notifications.length).toBe(before);
  });

  it("DB-04 withTx keeps every write when all steps succeed, and later reads see them", async () => {
    await withTx(async (tx) => {
      await addNotification(tx, "user_customer", "test", "Kept", "/");
      expect((await notificationsOf(tx, "user_customer")).some((n) => n.title === "Kept")).toBe(true);
    });
    expect((await notificationsOf(db, "user_customer")).some((n) => n.title === "Kept")).toBe(true);
  });

  it("DB-06 a conditional status update returns nothing when the status already changed", async () => {
    const shop = (await findShopByOwner(db, "user_seller"))!;
    const so = newOrderOf(shop.id);
    await withTx(async (tx) => {
      expect(await updateSellerOrder(tx, so.id, { status: "ACCEPTED" }, { from: "NEW" })).toBeDefined();
      expect(await updateSellerOrder(tx, so.id, { status: "CANCELLED" }, { from: "NEW" })).toBeUndefined();
    });
    expect((await findSellerOrder(db, so.id))!.status).toBe("ACCEPTED");
  });

  it("DB-06 two sellers' tabs accepting the same order: the second gets a clear conflict", async () => {
    const shop = (await findShopByOwner(db, "user_seller"))!;
    const so = newOrderOf(shop.id);
    const seller = user("user_seller");
    await transitionSellerOrder(seller, { sellerOrderId: so.id, to: "ACCEPTED" });
    await expect(transitionSellerOrder(seller, { sellerOrderId: so.id, to: "ACCEPTED" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("BE-03 the shared read handle refuses writes", async () => {
    const shop = (await findShopBySlug(db, "ambalangoda-mask-house"))!;
    await expect(updateShop(db, shop.id, { name: "Changed" })).rejects.toThrow(/withTx/);
    expect((await findShopBySlug(db, "ambalangoda-mask-house"))!.name).toBe(shop.name);
  });

  it("BE-01 rows read inside a transaction can only change through repository writes", async () => {
    await withTx(async (tx) => {
      const shop = (await findShopBySlug(tx, "ambalangoda-mask-house"))!;
      expect(() => Object.assign(shop, { name: "Changed" })).toThrow(TypeError);
    });
  });
});
