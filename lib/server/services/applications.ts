import "server-only";
import { REAPPLY_WAIT_DAYS } from "@/lib/config";
import type { ApplicationStatus, SellerApplication, Shop } from "@/lib/types";
import type { ApplicationInput, DecisionInput } from "@/lib/validation/application";
import { withTx, type Tx } from "../db/tx";
import { queueEmail } from "../email/queue";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertEmailVerified, assertRole, type Actor } from "../permissions";
import { insertShop, shopSlugs } from "../repositories/catalogue";
import {
  addNotification,
  applicationsOf,
  deleteSessionsOf,
  findApplicationById,
  findUserById,
  insertApplication,
  listAdminIds,
  newId,
  updateApplication,
  updateUser,
} from "../repositories/people";
import { assertRateLimit, assertTransition, audit, slugify, staleStatus, uniqueSlug } from "./shared";
import { assertPhotosUsable } from "./uploads";

// Feature spec 8.1: seller application status flow.
const FLOW: Partial<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  PENDING: ["APPROVED", "REJECTED", "NEEDS_CHANGES", "WITHDRAWN"],
  NEEDS_CHANGES: ["PENDING", "WITHDRAWN"],
};

const OPEN: ApplicationStatus[] = ["PENDING", "NEEDS_CHANGES"];

async function notifyAdmins(tx: Tx, title: string, href: string) {
  for (const id of await listAdminIds(tx)) await addNotification(tx, id, "application.submitted", title, href);
}

/**
 * FR-2a: a customer applies to open a shop (they can't sell directly). RULE-A1: one open application per person;
 * a rejected applicant waits before applying again.
 */
export async function submitApplication(
  actor: Actor,
  input: ApplicationInput,
  now = new Date(),
): Promise<SellerApplication> {
  if (actor.role !== "CUSTOMER") throw new ForbiddenError("Only customer accounts can apply to open a shop.");
  assertEmailVerified(actor); // AU-01: selling needs a confirmed email
  return withTx(async (tx) => {
    const mine = await applicationsOf(tx, actor.id);
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
    await assertRateLimit(tx, actor.id, "application", now);
    // SEC-A2 (B09): photos already on the application being edited stay; new ones must be this person's uploads.
    await assertPhotosUsable(
      tx,
      actor,
      input.workPhotoIds.map((id, i) => ({ field: `workPhotoIds.${i}`, id, purpose: "APPLICATION_PHOTO" as const })),
      open?.workPhotoIds,
    );
    const fields = {
      applicantName: input.applicantName,
      phone: input.phone,
      businessType: input.businessType,
      businessRegNo: input.businessRegNo,
      shopName: input.shopName,
      craft: input.craft,
      categorySlugs: input.categorySlugs,
      address: input.address,
      story: input.story,
      workPhotoIds: input.workPhotoIds,
      socialUrl: input.socialUrl,
      acceptedTermsAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (open) {
      // NEEDS_CHANGES → PENDING: the applicant edits and resubmits the same application.
      assertTransition(FLOW, open.status, "PENDING", "application");
      const updated = await updateApplication(tx, open.id, { ...fields, status: "PENDING" }, { from: open.status });
      if (!updated) throw staleStatus("application");
      await notifyAdmins(tx, `${input.shopName} updated their application`, `/admin/applications/${open.id}`);
      return updated;
    }
    const application = await insertApplication(tx, {
      id: newId("app"),
      userId: actor.id,
      status: "PENDING",
      createdAt: now.toISOString(),
      ...fields,
    });
    await notifyAdmins(tx, `New seller application: ${input.shopName}`, `/admin/applications/${application.id}`);
    return application;
  });
}

export async function withdrawApplication(actor: Actor): Promise<void> {
  await withTx(async (tx) => {
    const open = (await applicationsOf(tx, actor.id)).find((a) => OPEN.includes(a.status));
    if (!open) throw new NotFoundError("You have no open application.");
    assertTransition(FLOW, open.status, "WITHDRAWN", "application");
    const updated = await updateApplication(
      tx,
      open.id,
      { status: "WITHDRAWN", updatedAt: new Date().toISOString() },
      { from: open.status },
    );
    if (!updated) throw staleStatus("application");
  });
}

function shopFromApplication(app: SellerApplication, ownerName: string, taken: Set<string>, now: Date): Shop {
  const slug = uniqueSlug(slugify(app.shopName), taken);
  return {
    id: newId("shop"),
    ownerId: app.userId,
    slug,
    name: app.shopName,
    ownerName,
    district: app.address.district,
    craft: app.craft,
    story: app.story,
    quote: "",
    since: now.getFullYear(),
    isVerified: false,
    // Application photos stay private (B09), so the seller adds a logo and banner before the shop can go live.
    logo: { id: "", alt: "" },
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
  return withTx(async (tx) => {
    const app = await findApplicationById(tx, input.applicationId);
    if (!app) throw new NotFoundError("Application not found.");
    const to: ApplicationStatus =
      input.decision === "approve" ? "APPROVED" : input.decision === "reject" ? "REJECTED" : "NEEDS_CHANGES";
    assertTransition(FLOW, app.status, to, "application");
    const before = app.status;
    const decided = await updateApplication(
      tx,
      app.id,
      {
        status: to,
        decidedById: actor.id,
        decidedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        adminNote: input.decision === "approve" ? undefined : input.reason,
      },
      { from: before },
    );
    if (!decided) throw staleStatus("application");
    if (to === "APPROVED") {
      const applicant = await findUserById(tx, app.userId);
      if (!applicant || applicant.role !== "CUSTOMER")
        throw new ConflictError("This person can no longer become a seller.");
      await updateUser(tx, applicant.id, { role: "SELLER" });
      await deleteSessionsOf(tx, applicant.id); // AU-04: a new role means a fresh sign-in
      await insertShop(tx, shopFromApplication(decided, applicant.name, await shopSlugs(tx), now));
      await addNotification(
        tx,
        app.userId,
        "application.approved",
        "Your shop is approved. Set it up to start selling.",
        "/seller",
      );
    } else {
      const title =
        to === "REJECTED" ? "Your seller application was not approved" : "Changes requested on your seller application";
      await addNotification(tx, app.userId, `application.${to.toLowerCase()}`, title, "/account");
    }
    // B10: one email per decision; "changes requested" twice is two decisions, so the time is in the key.
    await queueEmail(tx, "application.decision", {
      userId: app.userId,
      key: `${app.id}:${now.toISOString()}`,
      data: { decision: to, reason: input.decision === "approve" ? undefined : input.reason || undefined },
    });
    await audit(tx, actor, `application.${to.toLowerCase()}`, "APPLICATION", app.id, {
      reason: input.decision === "approve" ? undefined : input.reason,
      before,
      after: to,
    });
    return decided;
  });
}
