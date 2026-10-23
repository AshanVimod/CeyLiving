// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/session";
import { withTestStore } from "@/test/store-helpers";

let session: Session | null = null;
vi.mock("@/lib/session", () => ({ getSession: async () => session }));
const { sellLinkTarget } = await import("./sell-link");
const { readStore } = await import("@/lib/server/store/dev-store");

withTestStore();
afterEach(() => (session = null));

const as = (id: string) => (session = { user: readStore().users.find((u) => u.id === id)! });

describe("FR-2a selling link in the header", () => {
  it("FR-2a visitors and customers are invited to open a shop, not to sell directly", async () => {
    expect(await sellLinkTarget()).toEqual({ href: "/sell", label: "Open a shop" });
    as("user_customer");
    expect(await sellLinkTarget()).toEqual({ href: "/sell", label: "Open a shop" });
  });

  it("FR-2a an applicant with an open application follows it", async () => {
    as("user_applicant");
    expect(await sellLinkTarget()).toEqual({ href: "/sell/apply", label: "My shop application" });
  });

  it("FR-2c a seller gets a link to post a new item", async () => {
    as("user_seller");
    expect(await sellLinkTarget()).toEqual({ href: "/seller/products/new", label: "Post an item" });
  });

  it("SEC-A1 admins see no selling link", async () => {
    as("user_admin");
    expect(await sellLinkTarget()).toBeNull();
  });
});
