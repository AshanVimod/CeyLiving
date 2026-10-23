import "server-only";
import { AUTO_HIDE_REPORT_THRESHOLD } from "@/lib/config";
import type { ContentStatus, ProductAnswer, ProductQuestion, Report, ReportTargetType, Review } from "@/lib/types";
import type {
  ModerationInput,
  OfficialReplyInput,
  ReportInput,
  ReportResolutionInput,
  RestrictionInput,
} from "@/lib/validation/content";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertRole, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { transaction, type StoreData } from "../store/dev-store";
import { assertRateLimit, assertTransition, audit } from "./shared";
import { addAnswer } from "./questions";

type Content = Review | ProductQuestion | ProductAnswer;
type ContentType = "REVIEW" | "QUESTION" | "ANSWER";

// Feature spec 8.4: content status flow.
const FLOW: Partial<Record<ContentStatus, readonly ContentStatus[]>> = {
  VISIBLE: ["HIDDEN", "DELETED"],
  HIDDEN: ["VISIBLE", "DELETED"],
};

function findContent(db: StoreData, type: ContentType, id: string): Content | undefined {
  if (type === "REVIEW") return db.reviews.find((r) => r.id === id);
  if (type === "QUESTION") return db.questions.find((q) => q.id === id);
  return db.answers.find((a) => a.id === id);
}

function targetExists(db: StoreData, type: ReportTargetType, id: string): boolean {
  if (type === "PRODUCT") return db.products.some((p) => p.id === id && p.status === "ACTIVE");
  if (type === "SHOP") return db.shops.some((s) => s.id === id && s.status === "ACTIVE");
  const content = findContent(db, type, id);
  return Boolean(content && content.status === "VISIBLE");
}

function resolveOpenReports(db: StoreData, actor: Actor, type: ReportTargetType, id: string, resolution: string) {
  db.reports
    .filter((r) => r.targetType === type && r.targetId === id && r.status === "OPEN")
    .forEach((r) => Object.assign(r, { status: "RESOLVED", resolvedById: actor.id, resolution }));
}

/** FR-8: any signed-in person reports content or a shop, once per target. RULE-M4 auto-hides heavily reported content. */
export async function reportContent(actor: Actor, input: ReportInput, now = new Date()): Promise<Report> {
  return transaction((db) => {
    if (!targetExists(db, input.targetType, input.targetId))
      throw new NotFoundError("That content isn’t available any more.");
    const duplicate = db.reports.some(
      (r) =>
        r.reporterId === actor.id &&
        r.targetType === input.targetType &&
        r.targetId === input.targetId &&
        r.status === "OPEN",
    );
    if (duplicate) throw new ConflictError("You’ve already reported this. We’ll look at it soon.");
    assertRateLimit(db, actor.id, "report", now);
    const report: Report = {
      id: newId("report"),
      reporterId: actor.id,
      ...input,
      status: "OPEN",
      createdAt: now.toISOString(),
    };
    db.reports.push(report);
    const open = db.reports.filter(
      (r) => r.targetType === input.targetType && r.targetId === input.targetId && r.status === "OPEN",
    ).length;
    if (input.targetType !== "PRODUCT" && input.targetType !== "SHOP" && open >= AUTO_HIDE_REPORT_THRESHOLD) {
      const content = findContent(db, input.targetType, input.targetId)!;
      Object.assign(content, {
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
  await transaction((db) => {
    const content = findContent(db, input.targetType, input.targetId);
    if (!content) throw new NotFoundError("Content not found.");
    const to: ContentStatus = input.action === "hide" ? "HIDDEN" : input.action === "restore" ? "VISIBLE" : "DELETED";
    assertTransition(FLOW, content.status, to, "post");
    const before = content.status;
    content.status = to;
    content.statusReason = input.action === "restore" ? undefined : input.reason;
    if (to === "DELETED") eraseBody(content);
    if (to !== "VISIBLE") {
      resolveOpenReports(db, actor, input.targetType, content.id, `${input.action}: ${input.reason}`);
      addNotification(
        db,
        content.authorId,
        `content.${input.action}`,
        `A moderator ${to === "HIDDEN" ? "hid" : "deleted"} one of your posts`,
        "/account/questions",
      );
    }
    audit(db, actor, `content.${input.action}`, input.targetType, content.id, {
      reason: input.reason || undefined,
      before,
      after: to,
    });
  });
}

/** Deleted rows stay for the audit trail, but the text is erased (personal data, illegal content). */
function eraseBody(content: Content) {
  if ("comment" in content)
    Object.assign(content, { comment: undefined, sellerReply: undefined, ceylivingReply: undefined });
  if ("body" in content) content.body = "";
}

/** Reply as CeyLiving: an official answer on a question, or an official reply under a review. */
export async function officialReply(actor: Actor, input: OfficialReplyInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  if (input.targetType === "QUESTION") {
    await transaction((db) => {
      addAnswer(db, actor, { questionId: input.targetId, body: input.body });
      audit(db, actor, "content.official_reply", "QUESTION", input.targetId);
    });
    return;
  }
  await transaction((db) => {
    const review = db.reviews.find((r) => r.id === input.targetId && r.status !== "DELETED");
    if (!review) throw new NotFoundError("Review not found.");
    review.ceylivingReply = input.body;
    audit(db, actor, "content.official_reply", "REVIEW", review.id);
  });
}

/** RULE-M3 / RULE-M5: mute or ban posting (never buying); admins can't restrict admins or themselves. */
export async function restrictUser(actor: Actor, input: RestrictionInput, now = new Date()): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await transaction((db) => {
    const target = db.users.find((u) => u.id === input.userId);
    if (!target) throw new NotFoundError("User not found.");
    if (target.id === actor.id || target.role === "ADMIN")
      throw new ForbiddenError("Admins can’t mute or ban another admin or themselves.");
    const before = { restriction: target.postingRestriction, mutedUntil: target.mutedUntil };
    if (input.action === "lift")
      Object.assign(target, { postingRestriction: "NONE", mutedUntil: undefined, restrictionReason: undefined });
    if (input.action === "ban")
      Object.assign(target, { postingRestriction: "BANNED", mutedUntil: undefined, restrictionReason: input.reason });
    if (input.action === "mute") {
      const until = new Date(now.getTime() + (input.days ?? 7) * 86_400_000).toISOString();
      Object.assign(target, { postingRestriction: "MUTED", mutedUntil: until, restrictionReason: input.reason });
    }
    const title =
      input.action === "lift" ? "You can post reviews and questions again" : "Your posting access has been limited";
    addNotification(db, target.id, `user.${input.action}`, title, "/account");
    audit(db, actor, `user.${input.action}`, "USER", target.id, {
      reason: input.reason,
      before,
      after: { restriction: target.postingRestriction, mutedUntil: target.mutedUntil },
    });
  });
}

/** Closes a report without (or after) acting on the content; recorded in the audit log. */
export async function resolveReport(actor: Actor, input: ReportResolutionInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await transaction((db) => {
    const report = db.reports.find((r) => r.id === input.reportId);
    if (!report) throw new NotFoundError("Report not found.");
    if (report.status !== "OPEN") throw new ConflictError("This report is already closed.");
    Object.assign(report, { status: input.status, resolvedById: actor.id, resolution: input.resolution });
    audit(db, actor, `report.${input.status.toLowerCase()}`, "REPORT", report.id, { reason: input.resolution });
  });
}
