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
import { out, rowsOf, writableRowsOf, type Tx } from "../db/tx";
import type { StoreData } from "../store/dev-store";

// Reviews, questions, answers, reports and helpful votes. The only code that touches these rows (BE-01).

export type Content = Review | ProductQuestion | ProductAnswer;
export type ContentType = "REVIEW" | "QUESTION" | "ANSWER";

const newestFirst = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

// ---------- Reviews ----------

export async function reviewsOfProduct(tx: Tx, productId: string): Promise<Review[]> {
  return out(
    tx,
    rowsOf(tx)
      .reviews.filter((r) => r.productId === productId)
      .sort(newestFirst),
  );
}

export async function visibleReviewsOfProduct(tx: Tx, productId: string): Promise<Review[]> {
  return (await reviewsOfProduct(tx, productId)).filter((r) => r.status === "VISIBLE");
}

export async function reviewsOfShop(tx: Tx, shopId: string): Promise<Review[]> {
  return out(
    tx,
    rowsOf(tx)
      .reviews.filter((r) => r.shopId === shopId)
      .sort(newestFirst),
  );
}

export async function reviewsByAuthor(tx: Tx, authorId: string): Promise<Review[]> {
  return out(
    tx,
    rowsOf(tx)
      .reviews.filter((r) => r.authorId === authorId)
      .sort(newestFirst),
  );
}

export async function listReviews(tx: Tx): Promise<Review[]> {
  return out(tx, rowsOf(tx).reviews);
}

export async function findReview(tx: Tx, id: string): Promise<Review | undefined> {
  return out(
    tx,
    rowsOf(tx).reviews.find((r) => r.id === id),
  );
}

export async function reviewForOrderItem(tx: Tx, orderItemId: string): Promise<Review | undefined> {
  return out(
    tx,
    rowsOf(tx).reviews.find((r) => r.orderItemId === orderItemId),
  );
}

/** Order items that already have a review (RULE-R1: one review per order item). */
export async function reviewedOrderItemIds(tx: Tx): Promise<Set<string>> {
  return new Set(
    rowsOf(tx)
      .reviews.map((r) => r.orderItemId)
      .filter((id): id is string => Boolean(id)),
  );
}

export async function insertReview(tx: Tx, review: Review): Promise<Review> {
  writableRowsOf(tx).reviews.push(structuredClone(review));
  return out(tx, review);
}

export async function updateReview(tx: Tx, id: string, patch: Partial<Review>): Promise<Review | undefined> {
  const review = writableRowsOf(tx).reviews.find((r) => r.id === id);
  if (!review) return undefined;
  Object.assign(review, patch);
  return out(tx, review);
}

// ---------- Questions and answers ----------

export async function questionsOfProduct(tx: Tx, productId: string): Promise<ProductQuestion[]> {
  return out(
    tx,
    rowsOf(tx)
      .questions.filter((q) => q.productId === productId)
      .sort(newestFirst),
  );
}

export async function questionsOfShop(tx: Tx, shopId: string): Promise<ProductQuestion[]> {
  return out(
    tx,
    rowsOf(tx)
      .questions.filter((q) => q.shopId === shopId)
      .sort(newestFirst),
  );
}

export async function questionsByAuthor(tx: Tx, authorId: string): Promise<ProductQuestion[]> {
  return out(
    tx,
    rowsOf(tx)
      .questions.filter((q) => q.authorId === authorId)
      .sort(newestFirst),
  );
}

export async function listQuestions(tx: Tx): Promise<ProductQuestion[]> {
  return out(tx, rowsOf(tx).questions);
}

export async function findQuestion(tx: Tx, id: string): Promise<ProductQuestion | undefined> {
  return out(
    tx,
    rowsOf(tx).questions.find((q) => q.id === id),
  );
}

export async function insertQuestion(tx: Tx, question: ProductQuestion): Promise<ProductQuestion> {
  writableRowsOf(tx).questions.push(structuredClone(question));
  return out(tx, question);
}

export async function answersOf(tx: Tx, questionId: string): Promise<ProductAnswer[]> {
  return out(
    tx,
    rowsOf(tx)
      .answers.filter((a) => a.questionId === questionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}

export async function listAnswers(tx: Tx): Promise<ProductAnswer[]> {
  return out(tx, rowsOf(tx).answers);
}

export async function findAnswer(tx: Tx, id: string): Promise<ProductAnswer | undefined> {
  return out(
    tx,
    rowsOf(tx).answers.find((a) => a.id === id),
  );
}

export async function insertAnswer(tx: Tx, answer: ProductAnswer): Promise<ProductAnswer> {
  writableRowsOf(tx).answers.push(structuredClone(answer));
  return out(tx, answer);
}

// ---------- Any post (moderation) ----------

function contentRows(rows: StoreData, type: ContentType): Content[] {
  if (type === "REVIEW") return rows.reviews;
  if (type === "QUESTION") return rows.questions;
  return rows.answers;
}

export async function findContent(tx: Tx, type: ContentType, id: string): Promise<Content | undefined> {
  return out(
    tx,
    contentRows(rowsOf(tx), type).find((c) => c.id === id),
  );
}

/** Sets status, reason and (for erasure) body fields on a review, question or answer. */
export async function updateContent(
  tx: Tx,
  type: ContentType,
  id: string,
  patch: { status?: ContentStatus; statusReason?: string; [field: string]: unknown },
): Promise<void> {
  const content = contentRows(writableRowsOf(tx), type).find((c) => c.id === id);
  if (content) Object.assign(content, patch);
}

/** FR-17: an anonymised author's name on every review and question they wrote. */
export async function renameAuthorOnPosts(tx: Tx, authorId: string, authorName: string): Promise<void> {
  const rows = writableRowsOf(tx);
  rows.reviews.filter((r) => r.authorId === authorId).forEach((r) => (r.authorName = authorName));
  rows.questions.filter((q) => q.authorId === authorId).forEach((q) => (q.authorName = authorName));
}

// ---------- Reports ----------

export async function listReports(tx: Tx): Promise<Report[]> {
  return out(tx, [...rowsOf(tx).reports].sort(newestFirst));
}

export async function openReportsFor(tx: Tx, targetType: ReportTargetType, targetId: string): Promise<Report[]> {
  return out(
    tx,
    rowsOf(tx).reports.filter((r) => r.targetType === targetType && r.targetId === targetId && r.status === "OPEN"),
  );
}

export async function reportsByReporter(tx: Tx, reporterId: string): Promise<Report[]> {
  return out(
    tx,
    rowsOf(tx).reports.filter((r) => r.reporterId === reporterId),
  );
}

export async function findReport(tx: Tx, id: string): Promise<Report | undefined> {
  return out(
    tx,
    rowsOf(tx).reports.find((r) => r.id === id),
  );
}

export async function insertReport(tx: Tx, report: Report): Promise<Report> {
  writableRowsOf(tx).reports.push(structuredClone(report));
  return out(tx, report);
}

/** DB-06: only an OPEN report is updated; returns undefined when it is missing or already closed. */
export async function updateOpenReport(tx: Tx, id: string, patch: Partial<Report>): Promise<Report | undefined> {
  const report = writableRowsOf(tx).reports.find((r) => r.id === id && r.status === "OPEN");
  if (!report) return undefined;
  Object.assign(report, patch);
  return out(tx, report);
}

/** Closes every open report on one target (after a moderator acted on it). */
export async function resolveOpenReportsFor(
  tx: Tx,
  targetType: ReportTargetType,
  targetId: string,
  patch: Pick<Report, "status" | "resolvedById" | "resolution">,
): Promise<void> {
  writableRowsOf(tx)
    .reports.filter((r) => r.targetType === targetType && r.targetId === targetId && r.status === "OPEN")
    .forEach((r) => Object.assign(r, patch));
}

// ---------- Helpful votes (FR-19) ----------

type VoteTarget = HelpfulVote["targetType"];

export async function votesFor(tx: Tx, targetType: VoteTarget, targetIds: string[]): Promise<HelpfulVote[]> {
  const wanted = new Set(targetIds);
  return out(
    tx,
    rowsOf(tx).helpfulVotes.filter((v) => v.targetType === targetType && wanted.has(v.targetId)),
  );
}

export async function countVotes(tx: Tx, targetType: VoteTarget, targetId: string): Promise<number> {
  return rowsOf(tx).helpfulVotes.filter((v) => v.targetType === targetType && v.targetId === targetId).length;
}

export async function insertVote(tx: Tx, vote: HelpfulVote): Promise<void> {
  writableRowsOf(tx).helpfulVotes.push({ ...vote });
}

/** Removes the user's vote on a target; false when there was none. */
export async function deleteVote(tx: Tx, userId: string, targetType: VoteTarget, targetId: string): Promise<boolean> {
  const rows = writableRowsOf(tx);
  const index = rows.helpfulVotes.findIndex(
    (v) => v.userId === userId && v.targetType === targetType && v.targetId === targetId,
  );
  if (index === -1) return false;
  rows.helpfulVotes.splice(index, 1);
  return true;
}

export async function deleteVotesOf(tx: Tx, userId: string): Promise<void> {
  const rows = writableRowsOf(tx);
  rows.helpfulVotes = rows.helpfulVotes.filter((v) => v.userId !== userId);
}
