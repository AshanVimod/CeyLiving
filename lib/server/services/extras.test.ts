// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { customRequestSchema, deleteAccountSchema } from "@/lib/validation/more";
import { withTestStore, user } from "@/test/store-helpers";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { readStore, transaction } from "../store/dev-store";
import { byHelpfulness, changeRole, helpfulCounts, toggleHelpful } from "./community-extras";
import {
  createCustomRequest,
  declineCustomRequest,
  effectiveStatus,
  quoteCustomRequest,
  respondToQuote,
} from "./custom-requests";
import { commissionFor, generatePayouts, markPayoutPaid, sellerPayoutSummary } from "./payouts";
import { deleteMyAccount, exportMyData } from "./privacy";

let cookieUser = "user_customer";
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: cookieUser }) }) }));
const { getSession } = await import("@/lib/session");

withTestStore();

const RATA = "shop_rata-studio";

describe("FR-13 payouts (BR-10, BR-11)", () => {
  it("BR-10 commission is the rounded share of the item subtotal only", () => {
    expect(commissionFor({ subtotalCents: 1_850_000 })).toBe(185_000);
    expect(commissionFor({ subtotalCents: 12_345 })).toBe(1_235);
  });

  it("BR-11 pays orders only after the hold, once each, and skips shops without payout details", async () => {
    await transaction((db) => {
      db.shops.find((s) => s.id === RATA)!.payoutAccountMasked = undefined;
    });
    const created = await generatePayouts(user("user_admin"));
    const db = readStore();
    expect(created.length).toBeGreaterThan(0);
    expect(created.some((p) => p.shopId === RATA)).toBe(false);
    const macrame = db.sellerOrders.find((so) => so.id === "so_000112")!; // delivered 5 days ago: still on hold
    expect(macrame.payoutId).toBeUndefined();
    for (const p of created) {
      const orders = db.sellerOrders.filter((so) => p.sellerOrderIds.includes(so.id));
      expect(p.netCents).toBe(orders.reduce((s, so) => s + so.subtotalCents + so.shippingCents - commissionFor(so), 0));
    }
    expect(await generatePayouts(user("user_admin"))).toEqual([]); // nothing paid twice
  });

  it("only admins run payouts; marking paid needs a scheduled payout and is audited", async () => {
    await expect(generatePayouts(user("user_seller"))).rejects.toBeInstanceOf(ForbiddenError);
    const [payout] = await generatePayouts(user("user_admin"));
    await markPayoutPaid(user("user_admin"), payout!.id, "BOC-2026-1001");
    await expect(markPayoutPaid(user("user_admin"), payout!.id, "BOC-2026-1002")).rejects.toBeInstanceOf(ConflictError);
    expect(readStore().auditLog.some((a) => a.action === "payout.paid" && a.targetId === payout!.id)).toBe(true);
  });

  it("a seller's summary shows only their own shop", async () => {
    await generatePayouts(user("user_admin"));
    const summary = sellerPayoutSummary(user("user_seller"));
    expect(summary.payouts.every((p) => p.shopId === "shop_ambalangoda-mask-house")).toBe(true);
  });
});

describe("FR-14 custom requests", () => {
  const ask = () =>
    createCustomRequest(
      user("user_customer"),
      customRequestSchema.parse({
        shopId: RATA,
        message: "A pencil portrait of our two dogs, A3 if possible.",
        budget: "15000",
      }),
    );

  it("routes a request to the chosen maker, who quotes; the customer accepts", async () => {
    const request = await ask();
    expect(request.budgetCents).toBe(1_500_000);
    expect(readStore().notifications.some((n) => n.type === "request.created")).toBe(true);
    await quoteCustomRequest(user("user_owner_rata-studio"), { requestId: request.id, price: 1_800_000, days: 14 });
    const accepted = await respondToQuote(user("user_customer"), request.id, "accept");
    expect(accepted.status).toBe("ACCEPTED");
  });

  it("another seller can't quote, and the customer can't answer someone else's quote", async () => {
    const request = await ask();
    await expect(
      quoteCustomRequest(user("user_seller"), { requestId: request.id, price: 100_000, days: 3 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await quoteCustomRequest(user("user_owner_rata-studio"), { requestId: request.id, price: 1_800_000, days: 14 });
    await expect(respondToQuote(user("user_applicant"), request.id, "accept")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("declined requests can't be quoted; stale ones expire", async () => {
    const request = await ask();
    await declineCustomRequest(user("user_owner_rata-studio"), request.id, "Fully booked this month.");
    await expect(
      quoteCustomRequest(user("user_owner_rata-studio"), { requestId: request.id, price: 100_000, days: 3 }),
    ).rejects.toBeInstanceOf(ConflictError);
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect(effectiveStatus({ ...request, status: "OPEN" }, later)).toBe("EXPIRED");
  });

  it("RULE-Q4 requests can't carry contact details; sellers can't ask their own shop", async () => {
    expect(
      customRequestSchema.safeParse({ shopId: RATA, message: "Please call me on 0771234567 to talk about it." })
        .success,
    ).toBe(false);
    await expect(
      createCustomRequest(user("user_seller"), {
        shopId: "shop_ambalangoda-mask-house",
        message: "Asking my own shop for a mask please.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("FR-16 role changes", () => {
  it("an admin can make a customer an admin, with an audit row", async () => {
    await changeRole(user("user_admin"), {
      userId: "user_applicant",
      role: "ADMIN",
      reason: "Joining the support team.",
    });
    expect(user("user_applicant").role).toBe("ADMIN");
    expect(readStore().auditLog.some((a) => a.action === "user.role_changed" && a.targetId === "user_applicant")).toBe(
      true,
    );
  });

  it("RULE-M5 never another admin or themselves; sellers only via closing the shop", async () => {
    await expect(
      changeRole(user("user_admin"), { userId: "user_admin", role: "ADMIN", reason: "Promoting myself again." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      changeRole(user("user_admin"), { userId: "user_seller", role: "ADMIN", reason: "Seller to admin directly." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      changeRole(user("user_customer"), { userId: "user_muted", role: "ADMIN", reason: "Customer tries to promote." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("FR-17 data export and account deletion", () => {
  it("the export contains only the requester's own data", () => {
    const data = exportMyData(user("user_customer"));
    expect(data.profile.email).toBe("anushka@example.lk");
    expect(data.orders.length).toBeGreaterThan(0);
    const db = readStore();
    const mine = new Set(db.orders.filter((o) => o.customerId === "user_customer").map((o) => o.orderNumber));
    expect(data.orders.every((o) => mine.has(o.orderNumber))).toBe(true);
    expect(JSON.stringify(data)).not.toContain("tom@");
    expect(JSON.stringify(data)).not.toContain("user_reviewer_1");
  });

  it("deletion is refused while orders are on their way, and for admins and open shops", async () => {
    await expect(deleteMyAccount(user("user_customer"))).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteMyAccount(user("user_admin"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteMyAccount(user("user_seller"))).rejects.toBeInstanceOf(ConflictError);
    expect(deleteAccountSchema.safeParse({ confirm: "delete" }).success).toBe(false);
  });

  it("deletion anonymises the person, keeps order records, and blocks sign-in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const reviewer = user("user_reviewer_1"); // Tom: delivered orders only
    cookieUser = reviewer.id;
    expect((await getSession())?.user.id).toBe(reviewer.id);
    await deleteMyAccount(reviewer);
    const db = readStore();
    const after = db.users.find((u) => u.id === reviewer.id)!;
    expect(after.name).toBe("Former customer");
    expect(after.phone).toBeUndefined();
    expect(after.email).not.toContain("@example");
    expect(db.reviews.filter((r) => r.authorId === reviewer.id).every((r) => r.authorName === "Former customer")).toBe(
      true,
    );
    expect(db.orders.some((o) => o.customerId === reviewer.id)).toBe(true);
    expect(await getSession()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("FR-19 helpful votes", () => {
  it("toggles one vote per person, never on your own post, and sorts the most helpful first", async () => {
    const reviews = readStore().reviews.filter((r) => r.productId === "prod_custom-pencil-portrait");
    const [first, second] = reviews;
    expect(await toggleHelpful(user("user_customer"), { targetType: "REVIEW", targetId: second!.id })).toEqual({
      voted: true,
      count: 1,
    });
    expect(await toggleHelpful(user("user_customer"), { targetType: "REVIEW", targetId: second!.id })).toEqual({
      voted: false,
      count: 0,
    });
    await toggleHelpful(user("user_customer"), { targetType: "REVIEW", targetId: second!.id });
    await expect(
      toggleHelpful(user(first!.authorId), { targetType: "REVIEW", targetId: first!.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { counts, mine } = helpfulCounts(
      "REVIEW",
      reviews.map((r) => r.id),
      "user_customer",
    );
    expect(mine.has(second!.id)).toBe(true);
    expect(byHelpfulness(reviews, counts)[0]!.id).toBe(second!.id);
  });
});
