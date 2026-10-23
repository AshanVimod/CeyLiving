import "server-only";
import { AUTO_HIDE_REPORT_THRESHOLD } from "@/lib/config";
import type { ContentStatus, Report, ReportTargetType, User } from "@/lib/types";
import type {
  ModerationInput,
  OfficialReplyInput,
  ReportInput,
  ReportResolutionInput,
  RestrictionInput,
} from "@/lib/validation/content";
import { withTx, type Tx } from "../db/tx";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertRole, type Actor } from "../permissions";
import { findProductById, findShopById } from "../repositories/catalogue";
import {
  findContent,
  findReport,
  findReview,
  insertReport,
  openReportsFor,
  resolveOpenReportsFor,
  updateContent,
  updateOpenReport,
  updateReview,
  type Content,
} from "../repositories/content";
import { addNotification, findUserById, newId, updateUser } from "../repositories/people";
import { assertRateLimit, assertTransition, audit } from "./shared";
import { addAnswer } from "./questions";

// Feature spec 8.4: content status flow.
const FLOW: Partial<Record<ContentStatus, readonly ContentStatus[]>> = {
  VISIBLE: ["HIDDEN", "DELETED"],
  HIDDEN: ["VISIBLE", "DELETED"],
};

async function targetExists(tx: Tx, type: ReportTargetType, id: string): Promise<boolean> {
  if (type === "PRODUCT") return (await findProductById(tx, id))?.status === "ACTIVE";
  if (type === "SHOP") return (await findShopById(tx, id))?.status === "ACTIVE";
  return (await findContent(tx, type, id))?.status === "VISIBLE";
}

/** FR-8: any signed-in person reports content or a shop, once per target. RULE-M4 auto-hides heavily reported content. */
export async function reportContent(actor: Actor, input: ReportInput, now = new Date()): Promise<Report> {
  return withTx(async (tx) => {
    if (!(await targetExists(tx, input.targetType, input.targetId)))
      throw new NotFoundError("That content isn’t available any more.");
    const openBefore = await openReportsFor(tx, input.targetType, input.targetId);
    if (openBefore.some((r) => r.reporterId === actor.id))
      throw new ConflictError("You’ve already reported this. We’ll look at it soon.");
    await assertRateLimit(tx, actor.id, "report", now);
    const report = await insertReport(tx, {
      id: newId("report"),
      reporterId: actor.id,
      ...input,
      status: "OPEN",
      createdAt: now.toISOString(),
    });
    const open = openBefore.length + 1;
    if (input.targetType !== "PRODUCT" && input.targetType !== "SHOP" && open >= AUTO_HIDE_REPORT_THRESHOLD) {
      await updateContent(tx, input.targetType, input.targetId, {
        status: "HIDDEN",
        statusReason: `Hidden automatically after ${open} reports, waiting for review.`,
      });
    }
    return report;
  });
}

/** RULE-M1 / RULE-M2: admins hide, restore or delete content (with a reason) but never edit it. */
export async function moderateContent(actor: Actor, input: ModerationInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const content = await findContent(tx, input.targetType, input.targetId);
    if (!content) throw new NotFoundError("Content not found.");
    const to: ContentStatus = input.action === "hide" ? "HIDDEN" : input.action === "restore" ? "VISIBLE" : "DELETED";
    assertTransition(FLOW, content.status, to, "post");
    const before = content.status;
    await updateContent(tx, input.targetType, content.id, {
      status: to,
      statusReason: input.action === "restore" ? undefined : input.reason,
      ...(to === "DELETED" ? erasedBody(content) : {}),
    });
    if (to !== "VISIBLE") {
      await resolveOpenReportsFor(tx, input.targetType, content.id, {
        status: "RESOLVED",
        resolvedById: actor.id,
        resolution: `${input.action}: ${input.reason}`,
      });
      await addNotification(
        tx,
        content.authorId,
        `content.${input.action}`,
        `A moderator ${to === "HIDDEN" ? "hid" : "deleted"} one of your posts`,
        "/account/questions",
      );
    }
    await audit(tx, actor, `content.${input.action}`, input.targetType, content.id, {
      reason: input.reason || undefined,
      before,
      after: to,
    });
  });
}

/** Deleted rows stay for the audit trail, but the text is erased (personal data, illegal content). */
function erasedBody(content: Content): Record<string, unknown> {
  if ("comment" in content) return { comment: undefined, sellerReply: undefined, ceylivingReply: undefined };
  return { body: "" };
}

/** Reply as CeyLiving: an official answer on a question, or an official reply under a review. */
export async function officialReply(actor: Actor, input: OfficialReplyInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  if (input.targetType === "QUESTION") {
    await withTx(async (tx) => {
      await addAnswer(tx, actor, { questionId: input.targetId, body: input.body });
      await audit(tx, actor, "content.official_reply", "QUESTION", input.targetId);
    });
    return;
  }
  await withTx(async (tx) => {
    const review = await findReview(tx, input.targetId);
    if (!review || review.status === "DELETED") throw new NotFoundError("Review not found.");
    await updateReview(tx, review.id, { ceylivingReply: input.body });
    await audit(tx, actor, "content.official_reply", "REVIEW", review.id);
  });
}

/** RULE-M3 / RULE-M5: mute or ban posting (never buying); admins can't restrict admins or themselves. */
export async function restrictUser(actor: Actor, input: RestrictionInput, now = new Date()): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const target = await findUserById(tx, input.userId);
    if (!target) throw new NotFoundError("User not found.");
    if (target.id === actor.id || target.role === "ADMIN")
      throw new ForbiddenError("Admins can’t mute or ban another admin or themselves.");
    const before = { restriction: target.postingRestriction, mutedUntil: target.mutedUntil };
    let patch: Partial<User> = {};
    if (input.action === "lift")
      patch = { postingRestriction: "NONE", mutedUntil: undefined, restrictionReason: undefined };
    if (input.action === "ban")
      patch = { postingRestriction: "BANNED", mutedUntil: undefined, restrictionReason: input.reason };
    if (input.action === "mute") {
      const until = new Date(now.getTime() + (input.days ?? 7) * 86_400_000).toISOString();
      patch = { postingRestriction: "MUTED", mutedUntil: until, restrictionReason: input.reason };
    }
    const updated = await updateUser(tx, target.id, patch);
    const title =
      input.action === "lift" ? "You can post reviews and questions again" : "Your posting access has been limited";
    await addNotification(tx, target.id, `user.${input.action}`, title, "/account");
    await audit(tx, actor, `user.${input.action}`, "USER", target.id, {
      reason: input.reason,
      before,
      after: { restriction: updated.postingRestriction, mutedUntil: updated.mutedUntil },
    });
  });
}

/** Closes a report without (or after) acting on the content; recorded in the audit log. */
export async function resolveReport(actor: Actor, input: ReportResolutionInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const report = await findReport(tx, input.reportId);
    if (!report) throw new NotFoundError("Report not found.");
    // DB-06: only an OPEN report can close, so two admins resolving at once can't both succeed.
    const closed = await updateOpenReport(tx, report.id, {
      status: input.status,
      resolvedById: actor.id,
      resolution: input.resolution,
    });
    if (!closed) throw new ConflictError("This report is already closed.");
    await audit(tx, actor, `report.${input.status.toLowerCase()}`, "REPORT", report.id, { reason: input.resolution });
  });
}
