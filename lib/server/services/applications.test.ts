// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applicationSchema, decisionSchema } from "@/lib/validation/application";
import { validApplication } from "@/test/fixtures";
import { withTestStore, user } from "@/test/store-helpers";
import { ConflictError, ForbiddenError } from "../errors";
import { findShopByOwner } from "../repositories/catalogue";
import { readStore, transaction } from "../store/dev-store";
import { decideApplication, submitApplication } from "./applications";

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
    const shop = findShopByOwner("user_applicant", db)!;
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
});
