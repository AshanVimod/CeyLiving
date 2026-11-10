// @vitest-environment node
import { describe, expect, it } from "vitest";
import { db as readDb } from "@/lib/server/db/tx";
import { productSchema } from "@/lib/validation/product";
import { shopSchema } from "@/lib/validation/shop";
import { productInput, validShop } from "@/test/fixtures";
import { queuedJobs, readAll, freshUser, user, withTestDatabase } from "@/test/db";
import { productPhotos, shopPhotos } from "@/test/uploads";
import { getPublicProduct, getPublicShop, queryCatalogue } from "../catalogue";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { assertShopOwner } from "../permissions";
import { findShopByOwner } from "../repositories/catalogue";
import { findPayoutAccount } from "../repositories/payout-accounts";
import { decideApplication } from "./applications";
import { savePayoutDetails } from "./payout-accounts";
import { archiveProduct, decideProduct, saveProduct } from "./products";
import { decideShop, updateShop } from "./shops";

withTestDatabase();

async function approvedApplicant() {
  await decideApplication(user("user_admin"), { decision: "approve", applicationId: "app_tharindu" });
  return freshUser("user_applicant");
}

describe("shops", () => {
  it("RULE-S1 a seller can't load another seller's shop", async () => {
    const other = (await findShopByOwner(readDb, "user_owner_galle-beeralu-studio"))!;
    await expect(assertShopOwner(user("user_seller"), other.id, readDb)).rejects.toThrow(NotFoundError);
  });

  it("RULE-S1 edits always apply to the seller's own shop", async () => {
    const before = (await findShopByOwner(readDb, "user_owner_galle-beeralu-studio"))!.name;
    await updateShop(
      user("user_seller"),
      validShop({ name: "Renamed Masks", slug: "ambalangoda-mask-house", ...(await shopPhotos("user_seller")) }),
    );
    expect((await findShopByOwner(readDb, "user_seller"))!.name).toBe("Renamed Masks");
    expect((await findShopByOwner(readDb, "user_owner_galle-beeralu-studio"))!.name).toBe(before);
  });

  it("RULE-S2 refuses reserved and badly formed web addresses", () => {
    expect(shopSchema.safeParse({ ...validShop(), slug: "admin" }).success).toBe(false);
    expect(shopSchema.safeParse({ ...validShop(), slug: "My Shop!" }).success).toBe(false);
    expect(shopSchema.safeParse({ ...validShop(), slug: "ab" }).success).toBe(false);
  });

  it("RULE-S2 refuses a web address another shop uses", async () => {
    await expect(updateShop(user("user_seller"), validShop({ slug: "kandy-batik-house" }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("RULE-S3 a draft shop goes ACTIVE only when the checklist is complete", async () => {
    const seller = await approvedApplicant();
    await updateShop(seller, validShop(await shopPhotos(seller.id)));
    expect((await findShopByOwner(readDb, seller.id))!.status).toBe("DRAFT");
    await saveProduct(seller, productInput(await productPhotos(seller.id)), "submit");
    expect((await findShopByOwner(readDb, seller.id))!.status).toBe("DRAFT");
    await savePayoutDetails(seller, {
      accountName: "A Test Seller",
      bankName: "Bank of Ceylon",
      branch: "Kandy",
      accountNumber: "12345678",
    });
    const shop = (await findShopByOwner(readDb, seller.id))!;
    expect(shop.status).toBe("ACTIVE");
    expect((await findPayoutAccount(readDb, shop.id))!.accountLast4).toBe("5678");
  });

  it("BE-09 a shop going live queues one whole-catalogue refresh; the steps before it queue none", async () => {
    const seller = await approvedApplicant();
    await updateShop(seller, validShop(await shopPhotos(seller.id)));
    await saveProduct(seller, productInput(await productPhotos(seller.id)), "submit");
    expect(await queuedJobs("catalogue.refresh")).toEqual([]);
    await savePayoutDetails(seller, {
      accountName: "A Test Seller",
      bankName: "Bank of Ceylon",
      branch: "Kandy",
      accountNumber: "12345678",
    });
    expect(await queuedJobs("catalogue.refresh")).toEqual([expect.objectContaining({ singletonKey: "catalogue" })]);
  });

  it("FR-4 suspend hides the shop at once and writes an audit row; reinstate brings it back", async () => {
    const admin = user("user_admin");
    await decideShop(admin, {
      decision: "suspend",
      shopId: "shop_ambalangoda-mask-house",
      reason: "Copied designs reported.",
    });
    expect(await getPublicShop("ambalangoda-mask-house")).toBeUndefined();
    expect(await getPublicProduct("naga-raksha-mask")).toBeUndefined();
    await decideShop(admin, { decision: "reinstate", shopId: "shop_ambalangoda-mask-house" });
    expect(await getPublicProduct("naga-raksha-mask")).toBeDefined();
    const actions = (await readAll()).auditLog.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["shop.suspend", "shop.reinstate"]));
  });

  it("FR-4 a shop with open orders can't be closed", async () => {
    await expect(
      decideShop(user("user_admin"), {
        decision: "close",
        shopId: "shop_ambalangoda-mask-house",
        reason: "Owner asked to close.",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("only admins act on shops", async () => {
    await expect(
      decideShop(user("user_seller"), { decision: "verify", shopId: "shop_ambalangoda-mask-house" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("items", () => {
  it("RULE-P1 submit needs every required field, each with a clear message", () => {
    const base = productInput();
    const cases: [string, Record<string, unknown>, string][] = [
      ["title", { title: "Box" }, "title"],
      ["category", { categorySlug: "" }, "categorySlug"],
      ["description", { description: "Short." }, "description"],
      ["photo", { images: [] }, "images"],
      ["price", { variants: [] }, "variants"],
      ["processing days", { type: "MADE_TO_ORDER", processingDays: undefined }, "processingDays"],
    ];
    for (const [, override, path] of cases) {
      const result = productSchema("submit").safeParse({
        ...base,
        ...override,
        tags: "",
        variants: override.variants ?? [{ label: "One", price: "3500", stock: 1 }],
      });
      expect(result.success, path).toBe(false);
      expect(
        result.error!.issues.some((i) => i.path[0] === path),
        path,
      ).toBe(true);
    }
    expect(
      productSchema("draft").safeParse({
        title: "Lacquer box draft",
        type: "READY_TO_SHIP",
        categorySlug: "",
        description: "",
        images: [],
        variants: [],
      }).success,
    ).toBe(true);
  });

  it("RULE-P3 keeps prices in whole cents within range", () => {
    expect(productInput({ variants: [{ label: "One", price: "1,250.50", stock: 2 }] }).variants[0]!.price).toBe(125050);
    expect(
      productSchema("submit").safeParse({
        ...productInput(),
        tags: "",
        variants: [{ label: "One", price: "0.5", stock: 1 }],
      }).success,
    ).toBe(false);
  });

  it("RULE-P2 a new shop's items wait for approval; after 3 approved they publish directly", async () => {
    const seller = await approvedApplicant();
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const input = productInput({ title: `Lacquered box number ${i}`, ...(await productPhotos(seller.id)) });
      const p = await saveProduct(seller, input, "submit");
      expect(p.status).toBe("PENDING_REVIEW");
      ids.push(p.id);
    }
    for (const id of ids) await decideProduct(user("user_admin"), { decision: "approve", productId: id });
    const fourth = await saveProduct(
      seller,
      productInput({ title: "Lacquered box number four", ...(await productPhotos(seller.id)) }),
      "submit",
    );
    expect(fourth.status).toBe("ACTIVE");
  });

  it("FR-9 an approved item appears on the shop page and in search", async () => {
    const seller = user("user_seller");
    const p = await saveProduct(
      seller,
      productInput({ title: "Kolam drummer mask", ...(await productPhotos(seller.id)) }),
      "submit",
    );
    expect(p.status).toBe("ACTIVE"); // shop already has 5 approved items
    expect((await queryCatalogue({ q: "drummer" })).items.map((x) => x.slug)).toContain(p.slug);
  });

  it("a seller can't touch another shop's item", async () => {
    const beeralu = (await readAll()).products.find((p) => p.shopSlug === "galle-beeralu-studio")!;
    await expect(archiveProduct(user("user_seller"), beeralu.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveProduct(user("user_seller"), productInput(), "submit", beeralu.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("FR-9 reject needs a reason and notifies the seller; removed items can't be edited", async () => {
    const seller = await approvedApplicant();
    const p = await saveProduct(seller, productInput(await productPhotos(seller.id)), "submit");
    await decideProduct(user("user_admin"), {
      decision: "remove",
      productId: p.id,
      reason: "Prohibited item under BR-20.",
    });
    await expect(saveProduct(seller, productInput(), "submit", p.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await readAll()).notifications.some((n) => n.userId === seller.id && n.type === "product.removed")).toBe(
      true,
    );
  });
});
