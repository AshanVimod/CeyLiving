import "server-only";
import { REAPPLY_WAIT_DAYS } from "@/lib/config";
import type { ApplicationStatus, SellerApplication, Shop } from "@/lib/types";
import type { ApplicationInput, DecisionInput } from "@/lib/validation/application";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertRole, type Actor } from "../permissions";
import { addNotification, adminIds, newId, updateUser } from "../repositories/people";
import { transaction, type StoreData } from "../store/dev-store";
import { assertRateLimit, assertTransition, audit, slugify, uniqueSlug } from "./shared";

// Feature spec 8.1: seller application status flow.
const FLOW: Partial<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  PENDING: ["APPROVED", "REJECTED", "NEEDS_CHANGES", "WITHDRAWN"],
  NEEDS_CHANGES: ["PENDING", "WITHDRAWN"],
};

const OPEN: ApplicationStatus[] = ["PENDING", "NEEDS_CHANGES"];
const toPhoto = (url: string, alt: string) => ({
  id: url.replace("https://images.unsplash.com/photo-", "").split(/[?#]/)[0]!,
  alt,
});

function notifyAdmins(db: StoreData, title: string, href: string) {
  adminIds(db).forEach((id) => addNotification(db, id, "application.submitted", title, href));
}

/** RULE-A1: one open application per person; a rejected applicant waits before applying again. */
export async function submitApplication(
  actor: Actor,
  input: ApplicationInput,
  now = new Date(),
): Promise<SellerApplication> {
  if (actor.role !== "CUSTOMER") throw new ForbiddenError("Only customer accounts can apply to sell.");
  return transaction((db) => {
    const mine = db.applications.filter((a) => a.userId === actor.id);
    const open = mine.find((a) => OPEN.includes(a.status));
    if (open?.status === "PENDING") throw new ConflictError("You already have an application waiting for review.");
    const lastRejected = mine
      .filter((a) => a.status === "REJECTED")
      .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
    const waitUntil = lastRejected?.decidedAt ? Date.parse(lastRejected.decidedAt) + REAPPLY_WAIT_DAYS * 86_400_000 : 0;
    if (!open && waitUntil > now.getTime()) {
      throw new ConflictError(
        `You can apply again from ${new Date(waitUntil).toLocaleDateString("en-LK", { day: "numeric", month: "long", timeZone: "Asia/Colombo" })}.`,
      );
    }
    assertRateLimit(db, actor.id, "application", now);
    const fields = {
      shopName: input.shopName,
      craft: input.craft,
      categorySlug: input.categorySlug,
      district: input.district,
      story: input.story,
      phone: input.phone,
      workPhotoUrls: input.workPhotoUrls,
      socialUrl: input.socialUrl,
      acceptedTermsAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (open) {
      // NEEDS_CHANGES → PENDING: the applicant edits and resubmits the same application.
      assertTransition(FLOW, open.status, "PENDING", "application");
      Object.assign(open, fields, { status: "PENDING" as const });
      notifyAdmins(db, `${input.shopName} updated their application`, `/admin/applications/${open.id}`);
      return open;
    }
    const application: SellerApplication = {
      id: newId("app"),
      userId: actor.id,
      status: "PENDING",
      createdAt: now.toISOString(),
      ...fields,
    };
    db.applications.push(application);
    notifyAdmins(db, `New seller application: ${input.shopName}`, `/admin/applications/${application.id}`);
    return application;
  });
}

export async function withdrawApplication(actor: Actor): Promise<void> {
  await transaction((db) => {
    const open = db.applications.find((a) => a.userId === actor.id && OPEN.includes(a.status));
    if (!open) throw new NotFoundError("You have no open application.");
    assertTransition(FLOW, open.status, "WITHDRAWN", "application");
    open.status = "WITHDRAWN";
    open.updatedAt = new Date().toISOString();
  });
}

function shopFromApplication(app: SellerApplication, ownerName: string, db: StoreData, now: Date): Shop {
  const slug = uniqueSlug(slugify(app.shopName), new Set(db.shops.map((s) => s.slug)));
  return {
    id: newId("shop"),
    ownerId: app.userId,
    slug,
    name: app.shopName,
    ownerName,
    district: app.district,
    craft: app.craft,
    story: app.story,
    quote: "",
    since: now.getFullYear(),
    isVerified: false,
    logo: toPhoto(app.workPhotoUrls[0] ?? "", `${app.shopName} logo`),
    banner: { id: "", alt: "" },
    dispatchDays: "",
    returnPolicy: "",
    status: "DRAFT",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * RULE-A2: only admins decide; reject and request-changes need a reason the applicant sees.
 * RULE-A3: approval sets the application, the role and the new DRAFT shop in one transaction.
 */
export async function decideApplication(
  actor: Actor,
  input: DecisionInput,
  now = new Date(),
): Promise<SellerApplication> {
  assertRole(actor, ["ADMIN"]);
  return transaction((db) => {
    const app = db.applications.find((a) => a.id === input.applicationId);
    if (!app) throw new NotFoundError("Application not found.");
    const to: ApplicationStatus =
      input.decision === "approve" ? "APPROVED" : input.decision === "reject" ? "REJECTED" : "NEEDS_CHANGES";
    assertTransition(FLOW, app.status, to, "application");
    const before = app.status;
    Object.assign(app, {
      status: to,
      decidedById: actor.id,
      decidedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    app.adminNote = input.decision === "approve" ? undefined : input.reason;
    if (to === "APPROVED") {
      const applicant = db.users.find((u) => u.id === app.userId);
      if (!applicant || applicant.role !== "CUSTOMER")
        throw new ConflictError("This person can no longer become a seller.");
      updateUser(db, applicant.id, { role: "SELLER" });
      const shop = shopFromApplication(app, applicant.name, db, now);
      db.shops.push(shop);
      addNotification(
        db,
        app.userId,
        "application.approved",
        "Your shop is approved. Set it up to start selling.",
        "/seller",
      );
    } else {
      const title =
        to === "REJECTED" ? "Your seller application was not approved" : "Changes requested on your seller application";
      addNotification(db, app.userId, `application.${to.toLowerCase()}`, title, "/account");
    }
    audit(db, actor, `application.${to.toLowerCase()}`, "APPLICATION", app.id, {
      reason: input.decision === "approve" ? undefined : input.reason,
      before,
      after: to,
    });
    return app;
  });
}
