// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateTag } from "next/cache";
import { readAll, user, withTestDatabase } from "@/test/db";
import type { User } from "@/lib/types";

// The session is the only thing these tests control; everything else runs for real against a test database.
let sessionUser: User | null = null;
vi.mock("@/lib/session", () => ({
  DEMO_SESSION_COOKIE: "ceyliving_demo_session",
  getSession: async () => (sessionUser ? { user: sessionUser } : null),
}));

const admin = await import("./admin");
const community = await import("./community");
const selling = await import("./selling");
const account = await import("./account");
const extras = await import("./extras");
const uploads = await import("./uploads");
const { getPublicProduct, getPublicShop } = await import("../catalogue");

withTestDatabase();
beforeEach(() => (sessionUser = null));
afterEach(() => vi.unstubAllEnvs());

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  return fd;
};

const ACTIONS = {
  ...Object.fromEntries(Object.entries(admin).map(([k, v]) => [`admin.${k}`, v])),
  ...Object.fromEntries(Object.entries(community).map(([k, v]) => [`community.${k}`, v])),
  ...Object.fromEntries(Object.entries(account).map(([k, v]) => [`account.${k}`, v])),
  ...Object.fromEntries(Object.entries(extras).map(([k, v]) => [`extras.${k}`, v])),
  ...Object.fromEntries(
    Object.entries(selling)
      .filter(([k]) => k !== "submitApplicationAction")
      .map(([k, v]) => [`selling.${k}`, v]),
  ),
} as Record<string, (state: null, fd: FormData) => Promise<{ ok: boolean; message?: string }>>;

describe("SEC-A1 every server action denies guests", () => {
  it.each(Object.keys(ACTIONS))("%s refuses a signed-out visitor", async (name) => {
    const result = await ACTIONS[name]!(null, form({}));
    expect(result).toMatchObject({ ok: false, message: "Sign in to continue." });
  });
});

describe("SEC-A1 B09 the upload actions deny guests and check the input", () => {
  it.each(Object.keys(uploads))("uploads.%s refuses a signed-out visitor", async (name) => {
    const action = uploads[name as keyof typeof uploads] as (input: unknown) => Promise<{ ok: boolean }>;
    expect(await action({ uploadId: `upl_${crypto.randomUUID()}` })).toMatchObject({
      ok: false,
      message: "Sign in to continue.",
    });
  });

  it("SEC-07 a request for a non-image comes back as a field error", async () => {
    sessionUser = user("user_seller");
    const result = await uploads.requestUploadAction({
      purpose: "PRODUCT_IMAGE",
      contentType: "text/html",
      sizeBytes: 100,
    });
    expect(result).toMatchObject({ ok: false, fieldErrors: { contentType: "Choose a JPEG, PNG or WebP photo." } });
  });
});

describe("SEC-A1 / SEC-A2 roles and ownership are checked on the server, not by hidden buttons", () => {
  it("a customer can't approve applications", async () => {
    sessionUser = user("user_customer");
    const result = await admin.decideApplicationAction(
      null,
      form({ decision: "approve", applicationId: "app_tharindu" }),
    );
    expect(result.ok).toBe(false);
    expect((await readAll()).applications.find((a) => a.id === "app_tharindu")!.status).toBe("PENDING");
  });

  it("a seller can't suspend a shop", async () => {
    sessionUser = user("user_seller");
    const result = await admin.decideShopAction(
      null,
      form({ decision: "suspend", shopId: "shop_kandy-batik-house", reason: "Trying to suspend a rival." }),
    );
    expect(result.ok).toBe(false);
  });

  it("a seller can't move another shop's order, even with its ID", async () => {
    sessionUser = user("user_seller");
    const other = (await readAll()).sellerOrders.find((s) => s.shopId === "shop_nool-and-knot")!;
    const result = await selling.transitionOrderAction(null, form({ sellerOrderId: other.id, to: "ACCEPTED" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("SEC-A3 bad input comes back as field errors, not exceptions", async () => {
    sessionUser = user("user_customer");
    const result = await account.updateProfileAction(null, form({ name: "A", phone: "12345" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.fieldErrors ?? {})).toEqual(expect.arrayContaining(["name", "phone"]));
  });

  it("FR-1 a valid profile edit persists", async () => {
    sessionUser = user("user_customer");
    const result = await account.updateProfileAction(null, form({ name: "Anushka Perera-Silva", phone: "0779998877" }));
    expect(result.ok).toBe(true);
    expect((await readAll()).users.find((u) => u.id === "user_customer")).toMatchObject({
      name: "Anushka Perera-Silva",
      phone: "0779998877",
    });
  });

  it("CS-14 unexpected errors don't leak details", async () => {
    sessionUser = user("user_seller");
    const result = await selling.saveProductAction(null, form({ payload: "{not json", intent: "submit" }));
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(/SyntaxError|at JSON|stack/i);
  });
});

describe("B04a public pages show changes at once", () => {
  beforeEach(() => vi.mocked(updateTag).mockClear());
  const naga = async () => (await readAll()).products.find((p) => p.slug.includes("naga") && p.status === "ACTIVE")!;

  it("archiving an item expires the catalogue cache and takes it off the public catalogue", async () => {
    const item = await naga();
    expect(await getPublicProduct(item.slug)).toBeDefined();
    sessionUser = user("user_seller");
    expect(await selling.archiveProductAction(null, form({ productId: item.id }))).toMatchObject({ ok: true });
    expect(updateTag).toHaveBeenCalledWith("catalogue");
    expect(await getPublicProduct(item.slug)).toBeUndefined();
  });

  it("suspending a shop expires the catalogue cache and hides the shop", async () => {
    const shop = (await readAll()).shops.find((s) => s.slug === "ambalangoda-mask-house")!;
    sessionUser = user("user_admin");
    const result = await admin.decideShopAction(
      null,
      form({ decision: "suspend", shopId: shop.id, reason: "Checking the photos on these listings." }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(updateTag).toHaveBeenCalledWith("catalogue");
    expect(await getPublicShop(shop.slug)).toBeUndefined();
  });

  it("hiding a review expires the catalogue cache", async () => {
    const review = (await readAll()).reviews.find((r) => r.status === "VISIBLE")!;
    sessionUser = user("user_admin");
    const result = await admin.moderateAction(
      null,
      form({ targetType: "REVIEW", targetId: review.id, action: "hide", reason: "Contains personal details." }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(updateTag).toHaveBeenCalledWith("catalogue");
  });

  it("a failed change leaves the cache alone", async () => {
    sessionUser = user("user_customer");
    await admin.decideShopAction(null, form({ decision: "reinstate", shopId: "shop_x" }));
    expect(updateTag).not.toHaveBeenCalled();
  });
});
