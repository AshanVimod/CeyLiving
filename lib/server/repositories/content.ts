import "server-only";
import type {
  ContentStatus,
  HelpfulVote,
  ProductAnswer,
  ProductQuestion,
  Report,
  ReportTargetType,
  Review,
} from "@/lib/types";
import type { Prisma } from "../db/generated/client";
import { clearing, reviewColumns, toAnswer, toQuestion, toReport, toReview, toVote, withDates } from "../db/mappers";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// Reviews, questions, answers, reports and helpful votes. The only code that touches these rows (BE-01).

export type Content = Review | ProductQuestion | ProductAnswer;
export type ContentType = "REVIEW" | "QUESTION" | "ANSWER";

const newestFirst = [{ createdAt: "desc" }, { id: "desc" }] as const;
const oldestFirst = [{ createdAt: "asc" }, { id: "asc" }] as const;

// ---------- Reviews ----------

export async function reviewsOfProduct(tx: Tx, productId: string): Promise<Review[]> {
  const rows = await clientOf(tx).review.findMany({ where: { productId }, orderBy: [...newestFirst] });
  return rows.map(toReview);
}

export async function visibleReviewsOfProduct(tx: Tx, productId: string): Promise<Review[]> {
  const rows = await clientOf(tx).review.findMany({
    where: { productId, status: "VISIBLE" },
    orderBy: [...newestFirst],
  });
  return rows.map(toReview);
}

export async function reviewsOfShop(tx: Tx, shopId: string): Promise<Review[]> {
  const rows = await clientOf(tx).review.findMany({ where: { shopId }, orderBy: [...newestFirst] });
  return rows.map(toReview);
}

/**
 * The shop page's latest reviews (B13): VISIBLE reviews (RULE-R4) of the shop's ACTIVE items (RULE-P4), newest first,
 * at most `limit`, with each item's title. Reads only what the page shows.
 */
export async function latestPublicReviewsOfShop(
  tx: Tx,
  shopId: string,
  limit: number,
): Promise<{ review: Review; productTitle: string }[]> {
  const rows = await clientOf(tx).review.findMany({
    where: { shopId, status: "VISIBLE", product: { status: "ACTIVE" } },
    orderBy: [...newestFirst],
    take: Math.max(1, Math.min(limit, 50)),
    include: { product: { select: { title: true } } },
  });
  return rows.map(({ product, ...row }) => ({ review: toReview(row), productTitle: product.title }));
}

export async function reviewsByAuthor(tx: Tx, authorId: string): Promise<Review[]> {
  const rows = await clientOf(tx).review.findMany({ where: { authorId }, orderBy: [...newestFirst] });
  return rows.map(toReview);
}

export async function listReviews(tx: Tx): Promise<Review[]> {
  const rows = await clientOf(tx).review.findMany({ orderBy: [...oldestFirst] });
  return rows.map(toReview);
}

export async function findReview(tx: Tx, id: string): Promise<Review | undefined> {
  const row = await clientOf(tx).review.findUnique({ where: { id } });
  return row ? toReview(row) : undefined;
}

export async function reviewForOrderItem(tx: Tx, orderItemId: string): Promise<Review | undefined> {
  const row = await clientOf(tx).review.findUnique({ where: { orderItemId } });
  return row ? toReview(row) : undefined;
}

/** Order items that already have a review (RULE-R1: one review per order item, also a unique index). */
export async function reviewedOrderItemIds(tx: Tx): Promise<Set<string>> {
  const rows = await clientOf(tx).review.findMany({
    where: { orderItemId: { not: null } },
    select: { orderItemId: true },
  });
  return new Set(rows.map((row) => row.orderItemId!));
}

export async function insertReview(tx: Tx, review: Review): Promise<Review> {
  const data = reviewColumns(review) as Prisma.ReviewUncheckedCreateInput;
  return toReview(await writableClientOf(tx).review.create({ data }));
}

export async function updateReview(tx: Tx, id: string, patch: Partial<Review>): Promise<Review | undefined> {
  const data = clearing(reviewColumns(patch)) as Prisma.ReviewUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).review.updateMany({ where: { id }, data });
  return count === 0 ? undefined : findReview(tx, id);
}

// ---------- Questions and answers ----------

export async function questionsOfProduct(tx: Tx, productId: string): Promise<ProductQuestion[]> {
  const rows = await clientOf(tx).productQuestion.findMany({ where: { productId }, orderBy: [...newestFirst] });
  return rows.map(toQuestion);
}

export async function questionsOfShop(tx: Tx, shopId: string): Promise<ProductQuestion[]> {
  const rows = await clientOf(tx).productQuestion.findMany({ where: { shopId }, orderBy: [...newestFirst] });
  return rows.map(toQuestion);
}

export async function questionsByAuthor(tx: Tx, authorId: string): Promise<ProductQuestion[]> {
  const rows = await clientOf(tx).productQuestion.findMany({ where: { authorId }, orderBy: [...newestFirst] });
  return rows.map(toQuestion);
}

export async function listQuestions(tx: Tx): Promise<ProductQuestion[]> {
  const rows = await clientOf(tx).productQuestion.findMany({ orderBy: [...oldestFirst] });
  return rows.map(toQuestion);
}

export async function findQuestion(tx: Tx, id: string): Promise<ProductQuestion | undefined> {
  const row = await clientOf(tx).productQuestion.findUnique({ where: { id } });
  return row ? toQuestion(row) : undefined;
}

export async function insertQuestion(tx: Tx, question: ProductQuestion): Promise<ProductQuestion> {
  const data = withDates(question, ["createdAt"]) as Prisma.ProductQuestionUncheckedCreateInput;
  return toQuestion(await writableClientOf(tx).productQuestion.create({ data }));
}

export async function answersOf(tx: Tx, questionId: string): Promise<ProductAnswer[]> {
  const rows = await clientOf(tx).productAnswer.findMany({ where: { questionId }, orderBy: [...oldestFirst] });
  return rows.map(toAnswer);
}

/** Answers to several questions in one query (B13: no query per question), oldest first. */
export async function answersOfQuestions(tx: Tx, questionIds: string[]): Promise<ProductAnswer[]> {
  if (!questionIds.length) return [];
  const rows = await clientOf(tx).productAnswer.findMany({
    where: { questionId: { in: questionIds } },
    orderBy: [...oldestFirst],
  });
  return rows.map(toAnswer);
}

export async function listAnswers(tx: Tx): Promise<ProductAnswer[]> {
  const rows = await clientOf(tx).productAnswer.findMany({ orderBy: [...oldestFirst] });
  return rows.map(toAnswer);
}

export async function findAnswer(tx: Tx, id: string): Promise<ProductAnswer | undefined> {
  const row = await clientOf(tx).productAnswer.findUnique({ where: { id } });
  return row ? toAnswer(row) : undefined;
}

export async function insertAnswer(tx: Tx, answer: ProductAnswer): Promise<ProductAnswer> {
  const data = withDates(answer, ["createdAt"]) as Prisma.ProductAnswerUncheckedCreateInput;
  return toAnswer(await writableClientOf(tx).productAnswer.create({ data }));
}

// ---------- Any post (moderation) ----------

export async function findContent(tx: Tx, type: ContentType, id: string): Promise<Content | undefined> {
  if (type === "REVIEW") return findReview(tx, id);
  if (type === "QUESTION") return findQuestion(tx, id);
  return findAnswer(tx, id);
}

/** The only fields moderation may set on each kind of post: status, reason, and the text it erases on delete. */
const MODERATED_FIELDS: Record<ContentType, readonly string[]> = {
  REVIEW: ["status", "statusReason", "comment", "sellerReply", "ceylivingReply"],
  QUESTION: ["status", "statusReason", "body"],
  ANSWER: ["status", "statusReason", "body"],
};

/** Sets status, reason and (for erasure) body fields on a review, question or answer. */
export async function updateContent(
  tx: Tx,
  type: ContentType,
  id: string,
  patch: { status?: ContentStatus; statusReason?: string; [field: string]: unknown },
): Promise<void> {
  const unknown = Object.keys(patch).filter((key) => !MODERATED_FIELDS[type].includes(key));
  if (unknown.length) throw new Error(`updateContent cannot set ${unknown.join(", ")} on a ${type.toLowerCase()}`);
  // Every allowed field has the same column type on all three tables.
  const data = clearing(patch) as Prisma.ProductAnswerUncheckedUpdateManyInput & { comment?: string | null };
  const client = writableClientOf(tx);
  if (type === "REVIEW") await client.review.updateMany({ where: { id }, data });
  else if (type === "QUESTION") await client.productQuestion.updateMany({ where: { id }, data });
  else await client.productAnswer.updateMany({ where: { id }, data });
}

/** FR-17: an anonymised author's name on every review and question they wrote. The author id stays the same. */
export async function renameAuthorOnPosts(tx: Tx, authorId: string, authorName: string): Promise<void> {
  const client = writableClientOf(tx);
  await client.review.updateMany({ where: { authorId }, data: { authorName } });
  await client.productQuestion.updateMany({ where: { authorId }, data: { authorName } });
}

// ---------- Reports ----------

export async function listReports(tx: Tx): Promise<Report[]> {
  const rows = await clientOf(tx).report.findMany({ orderBy: [...newestFirst] });
  return rows.map(toReport);
}

export async function openReportsFor(tx: Tx, targetType: ReportTargetType, targetId: string): Promise<Report[]> {
  const rows = await clientOf(tx).report.findMany({
    where: { targetType, targetId, status: "OPEN" },
    orderBy: [...oldestFirst],
  });
  return rows.map(toReport);
}

/** Open reports per target for several targets in one grouped query (B13); targets without any are left out. */
export async function openReportCounts(
  tx: Tx,
  targetType: ReportTargetType,
  targetIds: string[],
): Promise<Map<string, number>> {
  if (!targetIds.length) return new Map();
  const rows = await clientOf(tx).report.groupBy({
    by: ["targetId"],
    where: { targetType, targetId: { in: targetIds }, status: "OPEN" },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.targetId, row._count._all]));
}

export async function reportsByReporter(tx: Tx, reporterId: string): Promise<Report[]> {
  const rows = await clientOf(tx).report.findMany({ where: { reporterId }, orderBy: [...oldestFirst] });
  return rows.map(toReport);
}

export async function findReport(tx: Tx, id: string): Promise<Report | undefined> {
  const row = await clientOf(tx).report.findUnique({ where: { id } });
  return row ? toReport(row) : undefined;
}

export async function insertReport(tx: Tx, report: Report): Promise<Report> {
  const data = withDates(report, ["createdAt"]) as Prisma.ReportUncheckedCreateInput;
  return toReport(await writableClientOf(tx).report.create({ data }));
}

/** DB-06: only an OPEN report is updated; returns undefined when it is missing or already closed. */
export async function updateOpenReport(tx: Tx, id: string, patch: Partial<Report>): Promise<Report | undefined> {
  const data = clearing(withDates(patch, ["createdAt"])) as Prisma.ReportUncheckedUpdateManyInput;
  const { count } = await writableClientOf(tx).report.updateMany({ where: { id, status: "OPEN" }, data });
  return count === 0 ? undefined : findReport(tx, id);
}

/** Closes every open report on one target (after a moderator acted on it). */
export async function resolveOpenReportsFor(
  tx: Tx,
  targetType: ReportTargetType,
  targetId: string,
  patch: Pick<Report, "status" | "resolvedById" | "resolution">,
): Promise<void> {
  await writableClientOf(tx).report.updateMany({
    where: { targetType, targetId, status: "OPEN" },
    data: clearing(patch) as Prisma.ReportUncheckedUpdateManyInput,
  });
}

// ---------- Helpful votes (FR-19) ----------

type VoteTarget = HelpfulVote["targetType"];

export async function votesFor(tx: Tx, targetType: VoteTarget, targetIds: string[]): Promise<HelpfulVote[]> {
  const rows = await clientOf(tx).helpfulVote.findMany({
    where: { targetType, targetId: { in: targetIds } },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
  });
  return rows.map(toVote);
}

export async function countVotes(tx: Tx, targetType: VoteTarget, targetId: string): Promise<number> {
  return clientOf(tx).helpfulVote.count({ where: { targetType, targetId } });
}

/** One vote per person per target: the primary key refuses a second one. */
export async function insertVote(tx: Tx, vote: HelpfulVote): Promise<void> {
  const data = withDates(vote, ["createdAt"]) as Prisma.HelpfulVoteUncheckedCreateInput;
  await writableClientOf(tx).helpfulVote.create({ data });
}

/** Removes the user's vote on a target; false when there was none. */
export async function deleteVote(tx: Tx, userId: string, targetType: VoteTarget, targetId: string): Promise<boolean> {
  const { count } = await writableClientOf(tx).helpfulVote.deleteMany({ where: { userId, targetType, targetId } });
  return count > 0;
}

export async function deleteVotesOf(tx: Tx, userId: string): Promise<void> {
  await writableClientOf(tx).helpfulVote.deleteMany({ where: { userId } });
}
