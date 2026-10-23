// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTestStore, user } from "@/test/store-helpers";
import type { User } from "@/lib/types";

// The session is the only thing these tests control; everything else runs for real against a test store.
let sessionUser: User | null = null;
vi.mock("@/lib/session", () => ({
  DEMO_SESSION_COOKIE: "ceyliving_demo_session",
  getSession: async () => (sessionUser ? { user: sessionUser } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const admin = await import("./admin");
const community = await import("./community");
const selling = await import("./selling");
const account = await import("./account");
const extras = await import("./extras");
const { readStore } = await import("../store/dev-store");

withTestStore();
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

describe("SEC-A1 / SEC-A2 roles and ownership are checked on the server, not by hidden buttons", () => {
  it("a customer can't approve applications", async () => {
    sessionUser = user("user_customer");
    const result = await admin.decideApplicationAction(
      null,
      form({ decision: "approve", applicationId: "app_tharindu" }),
    );
    expect(result.ok).toBe(false);
    expect(readStore().applications.find((a) => a.id === "app_tharindu")!.status).toBe("PENDING");
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
    const other = readStore().sellerOrders.find((s) => s.shopId === "shop_nool-and-knot")!;
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
    expect(readStore().users.find((u) => u.id === "user_customer")).toMatchObject({
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
