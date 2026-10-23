import "server-only";
import type { ContentStatus } from "@/lib/types";
import { readStore } from "./store/dev-store";

export interface QueueItem {
  type: "REVIEW" | "QUESTION" | "ANSWER";
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  status: ContentStatus;
  statusReason?: string;
  createdAt: string;
  openReports: number;
  context: { title: string; href?: string };
}

/** FR-5: one queue for reviews, questions and answers, most-reported first, then newest. */
export function moderationQueue(filter: { type?: string; view?: string }): QueueItem[] {
  const db = readStore();
  const reports = (type: string, id: string) =>
    db.reports.filter((r) => r.targetType === type && r.targetId === id && r.status === "OPEN").length;
  const productOf = (productId: string) => db.products.find((p) => p.id === productId);
  const userName = (id: string) => db.users.find((u) => u.id === id)?.name ?? "Unknown";

  const items: QueueItem[] = [
    ...db.reviews.map((r): QueueItem => {
      const p = productOf(r.productId);
      return {
        type: "REVIEW",
        id: r.id,
        text: r.comment ?? `(${r.rating} stars, no comment)`,
        authorId: r.authorId,
        authorName: r.authorName,
        status: r.status,
        statusReason: r.statusReason,
        createdAt: r.createdAt,
        openReports: reports("REVIEW", r.id),
        context: { title: `Review of ${p?.title ?? "an item"}`, href: p ? `/p/${p.slug}#review-${r.id}` : undefined },
      };
    }),
    ...db.questions.map((q): QueueItem => {
      const p = productOf(q.productId);
      return {
        type: "QUESTION",
        id: q.id,
        text: q.body,
        authorId: q.authorId,
        authorName: q.authorName,
        status: q.status,
        statusReason: q.statusReason,
        createdAt: q.createdAt,
        openReports: reports("QUESTION", q.id),
        context: { title: `Question on ${p?.title ?? "an item"}`, href: p ? `/p/${p.slug}#q-${q.id}` : undefined },
      };
    }),
    ...db.answers.map((a): QueueItem => {
      const q = db.questions.find((x) => x.id === a.questionId);
      const p = q ? productOf(q.productId) : undefined;
      return {
        type: "ANSWER",
        id: a.id,
        text: a.body,
        authorId: a.authorId,
        authorName: a.authorRole === "ADMIN" ? "CeyLiving team" : userName(a.authorId),
        status: a.status,
        statusReason: a.statusReason,
        createdAt: a.createdAt,
        openReports: reports("ANSWER", a.id),
        context: { title: `Answer on ${p?.title ?? "an item"}`, href: p && q ? `/p/${p.slug}#q-${q.id}` : undefined },
      };
    }),
  ];

  return items
    .filter((i) => !filter.type || filter.type === "ALL" || i.type === filter.type)
    .filter((i) => {
      if (filter.view === "reported") return i.openReports > 0;
      if (filter.view === "hidden") return i.status === "HIDDEN";
      if (filter.view === "deleted") return i.status === "DELETED";
      return i.status !== "DELETED";
    })
    .sort((a, b) => b.openReports - a.openReports || b.createdAt.localeCompare(a.createdAt));
}
