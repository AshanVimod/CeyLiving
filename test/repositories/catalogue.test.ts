// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as catalogueRepo from "@/lib/server/repositories/catalogue";
import { queryPublicProducts } from "@/lib/server/repositories/catalogue-search";
import { ConflictError } from "@/lib/server/errors";
import { buildSeed, type SeedData } from "@/prisma/seed-data";
import type { Product, Shop } from "@/lib/types";
import { byId, repositoryBackend } from "./backends";

// Shops and products: the same suite on both backends, then what only PostgreSQL guarantees.

const { backends, pg } = await repositoryBackend(catalogueRepo);

const MASKS = "ambalangoda-mask-house";
const SUSPENDED = "pol-katu-lanka";

/** A product of `shop`, built from `base` with a fresh id and slug. */
function newProduct(base: Product, id: string, shopSlug: string): Product {
  return {
    ...structuredClone(base),
    id,
    slug: `${id}-slug`,
    shopSlug,
    status: "DRAFT",
    featuredRank: undefined,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
  };
}

/** The app treats a missing customization list and an empty one alike; PostgreSQL reads an empty one back as missing. */
const sameProduct = (product: Product) => ({
  ...product,
  customization: product.customization?.length ? product.customization : undefined,
});

for (const [name, backend] of backends) {
  describe(`catalogue repository contract: ${name}`, () => {
    const { repo, db, withTx, reset } = backend!;
    let seed: SeedData;
    beforeEach(async () => {
      seed = await reset();
    });

    it("BE-01 returns the stored shops and products as domain objects", async () => {
      expect(byId(await repo.listShops(db))).toEqual(byId(seed.shops));
      expect(byId(await repo.listProducts(db))).toEqual(byId(seed.products.map(sameProduct)));
      const product = seed.products[0];
      expect(await repo.findProductById(db, product.id)).toEqual(sameProduct(product));
      expect(await repo.findProductBySlug(db, product.slug)).toEqual(sameProduct(product));
      expect(await repo.findShopBySlug(db, MASKS)).toEqual(seed.shops.find((s) => s.slug === MASKS));
      expect(await repo.findShopById(db, "shop_nobody")).toBeUndefined();
      expect(await repo.shopSlugs(db)).toEqual(new Set(seed.shops.map((s) => s.slug)));
      expect(await repo.productSlugs(db, product.id)).toEqual(
        new Set(seed.products.filter((p) => p.id !== product.id).map((p) => p.slug)),
      );
    });

    it("RULE-S1 finds a seller's shop by owner, and never a closed one", async () => {
      const shop = (await repo.findShopBySlug(db, MASKS))!;
      expect((await repo.findShopByOwner(db, shop.ownerId))?.id).toBe(shop.id);
      await withTx((tx) => repo.updateShop(tx, shop.id, { status: "CLOSED" }));
      expect(await repo.findShopByOwner(db, shop.ownerId)).toBeUndefined();
    });

    it("DB-06 updateShop with `from` changes nothing once the status has moved on", async () => {
      const shop = (await repo.findShopBySlug(db, MASKS))!;
      const suspended = await withTx((tx) =>
        repo.updateShop(tx, shop.id, { status: "SUSPENDED", statusReason: "Checking photos" }, { from: "ACTIVE" }),
      );
      expect(suspended).toMatchObject({ status: "SUSPENDED", statusReason: "Checking photos" });
      expect(
        await withTx((tx) => repo.updateShop(tx, shop.id, { status: "CLOSED" }, { from: "ACTIVE" })),
      ).toBeUndefined();

      const restored = await withTx((tx) =>
        repo.updateShop(tx, shop.id, { status: "ACTIVE", statusReason: undefined, portrait: undefined }),
      );
      expect(restored?.statusReason).toBeUndefined();
      expect(restored?.portrait).toBeUndefined();
      expect(await repo.findShopById(db, shop.id)).toEqual(restored);
    });

    it("FR-2b stores a new shop with its photos", async () => {
      const base = seed.shops.find((s) => s.slug === MASKS)!;
      const shop: Shop = {
        ...structuredClone(base),
        id: "shop_new",
        slug: "new-shop",
        ownerId: "user_customer",
        status: "DRAFT",
        portrait: { id: "photo-portrait", alt: "The maker" },
      };
      expect(await withTx((tx) => repo.insertShop(tx, shop))).toEqual(shop);
      expect(await repo.findShopById(db, "shop_new")).toEqual(shop);
    });

    it("RULE-P4 / RULE-S4 shows only active items of active shops", async () => {
      const publicIds = (await queryPublicProducts(db, {})).items.map((p) => p.id).sort();
      const activeShops = new Set(seed.shops.filter((s) => s.status === "ACTIVE").map((s) => s.slug));
      const expected = seed.products.filter((p) => p.status === "ACTIVE" && activeShops.has(p.shopSlug));
      expect(publicIds).toEqual(expected.map((p) => p.id).sort());
      expect(byId(await repo.listPublicShops(db)).map((s) => s.slug)).toEqual(
        byId(seed.shops.filter((s) => s.status === "ACTIVE")).map((s) => s.slug),
      );
      expect(await repo.findPublicShopBySlug(db, SUSPENDED)).toBeUndefined();

      const item = expected.find((p) => p.shopSlug === MASKS)!;
      expect((await repo.findPublicProductBySlug(db, item.slug))?.id).toBe(item.id);
      const shop = (await repo.findShopBySlug(db, MASKS))!;
      await withTx((tx) => repo.updateShop(tx, shop.id, { status: "SUSPENDED" }));
      expect(await repo.findPublicProductBySlug(db, item.slug)).toBeUndefined();
      expect((await queryPublicProducts(db, {})).items.some((p) => p.shopSlug === MASKS)).toBe(false);
    });

    it("FR-2c stores a new item with its images, variants and customization fields in order", async () => {
      const base = seed.products.find((p) => p.customization?.length)!;
      const product = newProduct(base, "prod_new", MASKS);
      await withTx((tx) => repo.insertProduct(tx, product));
      expect(await repo.findProductById(db, "prod_new")).toEqual(product);
      expect((await repo.productsOfShopSlug(db, MASKS)).map((p) => p.id)).toContain("prod_new");
      const shop = (await repo.findShopBySlug(db, MASKS))!;
      expect((await repo.productsOfShop(db, shop.id)).map((p) => p.id).sort()).toEqual(
        (await repo.productsOfShopSlug(db, MASKS)).map((p) => p.id).sort(),
      );
    });

    it("FR-2c an edit replaces the images, variants and customization fields", async () => {
      const base = seed.products.find((p) => p.customization?.length)!;
      const patch: Partial<Product> = {
        title: "Edited title",
        images: [
          { id: "photo-b", alt: "Second" },
          { id: "photo-a", alt: "First" },
        ],
        variants: [{ sku: "NEW-1", label: "Only size", priceCents: 250_000, stock: 3 }],
        customization: [],
        processingDays: undefined,
      };
      const edited = await withTx((tx) => repo.updateProduct(tx, base.id, patch));
      expect(edited).toMatchObject({ title: "Edited title", images: patch.images, variants: patch.variants });
      expect(edited?.customization ?? []).toEqual([]);
      expect(edited?.processingDays).toBeUndefined();
      expect(sameProduct((await repo.findProductById(db, base.id))!)).toEqual(sameProduct(edited!));
    });

    it("DB-06 updateProduct with `from` changes nothing once the status has moved on", async () => {
      const product = seed.products.find((p) => p.status === "ACTIVE")!;
      const removed = await withTx((tx) =>
        repo.updateProduct(tx, product.id, { status: "REMOVED" }, { from: "ACTIVE" }),
      );
      expect(removed?.status).toBe("REMOVED");
      expect(
        await withTx((tx) => repo.updateProduct(tx, product.id, { status: "ARCHIVED" }, { from: "ACTIVE" })),
      ).toBeUndefined();
      expect(await withTx((tx) => repo.updateProduct(tx, "prod_nobody", { title: "x" }))).toBeUndefined();
    });

    it("FR-4 closing a shop archives its items, except ones CeyLiving removed", async () => {
      const [first, second] = seed.products.filter((p) => p.shopSlug === MASKS);
      await withTx((tx) => repo.updateProduct(tx, first.id, { status: "REMOVED" }));
      await withTx((tx) => repo.archiveProductsOfShopSlug(tx, MASKS));
      expect((await repo.findProductById(db, first.id))?.status).toBe("REMOVED");
      expect((await repo.findProductById(db, second.id))?.status).toBe("ARCHIVED");
      const others = (await repo.listProducts(db)).filter((p) => p.shopSlug !== MASKS);
      expect(others.map((p) => p.status)).toEqual(
        seed.products.filter((p) => p.shopSlug !== MASKS).map((p) => p.status),
      );
    });

    it("FR-2b a shop's items follow it to a new web address", async () => {
      const shop = (await repo.findShopBySlug(db, MASKS))!;
      const ids = (await repo.productsOfShopSlug(db, MASKS)).map((p) => p.id).sort();
      await withTx(async (tx) => {
        await repo.updateShop(tx, shop.id, { slug: "ambalangoda-masks" });
        await repo.moveProductsToShopSlug(tx, MASKS, "ambalangoda-masks");
      });
      expect((await repo.productsOfShopSlug(db, "ambalangoda-masks")).map((p) => p.id).sort()).toEqual(ids);
      expect(await repo.productsOfShopSlug(db, MASKS)).toEqual([]);
      expect((await repo.findProductById(db, ids[0]))?.shopSlug).toBe("ambalangoda-masks");
    });

    it("BE-03 the shared read handle refuses writes", async () => {
      await expect(repo.archiveProductsOfShopSlug(db, MASKS)).rejects.toThrow("withTx");
    });
  });
}

describe("catalogue (PostgreSQL only)", () => {
  const { handles } = pg;
  let seed: SeedData;
  beforeEach(async () => {
    seed = buildSeed(new Date());
    await pg.reset(seed);
  });
  const product = () => seed.products.find((p) => p.customization?.length)!;

  it("DB-04 a failed edit leaves the item, its images, variants and fields exactly as they were", async () => {
    const before = await catalogueRepo.findProductById(handles.db, product().id);
    await expect(
      handles.withTx((tx) =>
        catalogueRepo.updateProduct(tx, product().id, {
          title: "Half-saved",
          images: [{ id: "photo-z", alt: "New" }],
          variants: [{ sku: "BAD", label: "Bad", priceCents: 250_000, stock: -1 }],
        }),
      ),
    ).rejects.toThrow();
    expect(await catalogueRepo.findProductById(handles.db, product().id)).toEqual(before);
  });

  it("DB-07 the database refuses a price below 100 cents, negative stock and an unknown material", async () => {
    const edit = (patch: Partial<Product>) =>
      handles.withTx((tx) => catalogueRepo.updateProduct(tx, product().id, patch));
    await expect(edit({ variants: [{ sku: "A", label: "A", priceCents: 99, stock: 1 }] })).rejects.toThrow();
    await expect(edit({ variants: [{ sku: "A", label: "A", priceCents: 500, stock: -1 }] })).rejects.toThrow();
    await expect(edit({ materials: ["plastic" as never] })).rejects.toThrow();
  });

  it("RULE-S1 the database allows one open shop per owner, and a clash reads as a plain conflict", async () => {
    const existing = seed.shops.find((s) => s.slug === MASKS)!;
    const second: Shop = { ...structuredClone(existing), id: "shop_second", slug: "second-shop", status: "DRAFT" };
    const attempt = handles.withTx((tx) => catalogueRepo.insertShop(tx, second));
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow("You already have a shop.");
  });

  it("DB-06 a web address taken at the same moment reads as a plain conflict, not a database error", async () => {
    const copy = { ...newProduct(product(), "prod_copy", MASKS), slug: product().slug };
    const attempt = handles.withTx((tx) => catalogueRepo.insertProduct(tx, copy));
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow("That item web address was just taken. Try again.");
  });
});
