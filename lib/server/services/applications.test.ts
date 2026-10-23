// @vitest-environment node
import { describe, expect, it } from "vitest";
import { db as readDb } from "@/lib/server/db/tx";
import { applicationSchema, decisionSchema } from "@/lib/validation/application";
import { validApplication } from "@/test/fixtures";
import { withTestStore, user } from "@/test/store-helpers";
import { ConflictError, ForbiddenError } from "../errors";
import { findShopByOwner } from "../repositories/catalogue";
import { readStore, transaction } from "../store/dev-store";
import { decideApplication, submitApplication } from "./applications";
import { deleteMyAccount } from "./privacy";

withTestStore();

describe("seller applications", () => {
  it("FR-2a validates the form: story length, 3–6 photos, terms", () => {
    const result = applicationSchema.safeParse({
      ...validApplication(),
      story: "Too short",
      workPhotoUrls: ["https://example.com/a.jpg"],
      acceptTerms: undefined,
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["story", "workPhotoUrls.0", "acceptTerms"]));
  });

  it("RULE-A1 refuses a second application while one is open", async () => {
    await expect(submitApplication(user("user_applicant"), validApplication())).rejects.toBeInstanceOf(ConflictError);
  });

  it("RULE-A1 makes a rejected applicant wait before applying again", async () => {
    await decideApplication(
      user("user_admin"),
      decisionSchema.parse({
        decision: "reject",
        applicationId: "app_tharindu",
        reason: "Photos show factory-made items.",
      }),
    );
    await expect(submitApplication(user("user_applicant"), validApplication())).rejects.toThrow(/apply again from/);
  });

  it("lets a customer apply and notifies admins", async () => {
    const app = await submitApplication(user("user_customer"), validApplication());
    expect(app.status).toBe("PENDING");
    expect(readStore().notifications.some((n) => n.userId === "user_admin" && n.href.endsWith(app.id))).toBe(true);
  });

  it("only customers can apply", async () => {
    await expect(submitApplication(user("user_seller"), validApplication())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("RULE-A2 only admins decide, and reject needs a reason", async () => {
    await expect(
      decideApplication(user("user_customer"), { decision: "approve", applicationId: "app_tharindu" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(decisionSchema.safeParse({ decision: "reject", applicationId: "app_tharindu", reason: "no" }).success).toBe(
      false,
    );
  });

  it("RULE-A3 approval makes the applicant a seller with a DRAFT shop, with an audit row", async () => {
    await decideApplication(user("user_admin"), { decision: "approve", applicationId: "app_tharindu" });
    const db = readStore();
    expect(db.users.find((u) => u.id === "user_applicant")!.role).toBe("SELLER");
    const shop = (await findShopByOwner(readDb, "user_applicant"))!;
    expect(shop.status).toBe("DRAFT");
    expect(shop.slug).toBe("matale-laksha-works");
    expect(db.auditLog.some((a) => a.action === "application.approved" && a.targetId === "app_tharindu")).toBe(true);
  });

  it("RULE-A3 changes nothing when approval fails part-way", async () => {
    await transaction((db) => {
      db.users.find((u) => u.id === "user_applicant")!.role = "ADMIN"; // can't become a seller
    });
    const shopsBefore = readStore().shops.length;
    await expect(
      decideApplication(user("user_admin"), { decision: "approve", applicationId: "app_tharindu" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const db = readStore();
    expect(db.applications.find((a) => a.id === "app_tharindu")!.status).toBe("PENDING");
    expect(db.shops.length).toBe(shopsBefore);
    expect(db.auditLog.length).toBe(0);
  });

  it("request changes lets the applicant resubmit the same application", async () => {
    await decideApplication(user("user_admin"), {
      decision: "changes",
      applicationId: "app_tharindu",
      reason: "Add photos of finished pieces.",
    });
    const resubmitted = await submitApplication(user("user_applicant"), validApplication());
    expect(resubmitted.id).toBe("app_tharindu");
    expect(resubmitted.status).toBe("PENDING");
  });

  it("FR-2a an application needs the applicant, a shop address and 1 to 6 categories", () => {
    const base = validApplication();
    const missing = applicationSchema.safeParse({
      ...base,
      applicantName: "",
      categorySlugs: [],
      address: { ...base.address, line1: "", city: "" },
    });
    const paths = missing.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["applicantName", "categorySlugs", "address.line1", "address.city"]));
    const seven = [
      "wood-carvings",
      "traditional-art",
      "handloom-batik-lace",
      "sri-lankan-handicrafts",
      "wall-art-decor",
      "fashion-batik-wear",
      "jewellery-accessories",
    ];
    const tooMany = applicationSchema.safeParse({ ...base, categorySlugs: seven });
    expect(tooMany.error!.issues.map((i) => i.message)).toContain("Choose at most 6 categories.");
    expect(applicationSchema.safeParse({ ...base, categorySlugs: seven.slice(0, 6) }).success).toBe(true);
  });

  it("FR-2a keeps a registration number only for a registered business", () => {
    const base = validApplication();
    expect(applicationSchema.parse({ ...base, businessRegNo: "PV 12345" }).businessRegNo).toBeUndefined();
    const business = applicationSchema.parse({
      ...base,
      businessType: "REGISTERED_BUSINESS",
      businessRegNo: "PV 12345",
    });
    expect(business.businessRegNo).toBe("PV 12345");
  });

  it("FR-2a saves the applicant, categories and shop address with the application", async () => {
    const app = await submitApplication(user("user_customer"), validApplication());
    expect(app).toMatchObject({
      applicantName: "Nimali Perera",
      categorySlugs: ["home-decor", "eco-friendly"],
      address: { line1: "12 Temple Road", city: "Kelaniya", district: "Gampaha" },
    });
  });

  it("RULE-A3 the new shop's district comes from the application's shop address", async () => {
    await decideApplication(user("user_admin"), { decision: "approve", applicationId: "app_tharindu" });
    expect((await findShopByOwner(readDb, "user_applicant"))!.district).toBe("Matale");
  });

  it("FR-17 deleting the account removes the applicant's details from their applications", async () => {
    await deleteMyAccount(user("user_applicant"));
    const app = readStore().applications.find((a) => a.id === "app_tharindu")!;
    expect(app.status).toBe("WITHDRAWN");
    expect(app.applicantName).toBe("Former customer");
    expect(app.phone).toBe("");
    expect(app.address).toEqual({ line1: "", city: "", district: "Matale" });
  });
});
