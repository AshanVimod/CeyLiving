import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { listProducts } from "@/lib/server/repositories/catalogue";
import { listAnswers, questionsByAuthor } from "@/lib/server/repositories/content";
import { db } from "@/lib/server/db/tx";

export const metadata: Metadata = { title: "My questions" };

async function MyQuestions() {
  const user = await requireUser("/account/questions");
  const questions = (await questionsByAuthor(db, user.id)).filter((q) => q.status !== "DELETED");
  if (!questions.length) {
    return (
      <EmptyState title="No questions yet" text="Ask a maker about size, materials or delivery from any item page." />
    );
  }
  const [products, allAnswers] = await Promise.all([listProducts(db), listAnswers(db)]);
  return (
    <ul className="space-y-4">
      {questions.map((q) => {
        const product = products.find((p) => p.id === q.productId);
        const answers = allAnswers
          .filter((a) => a.questionId === q.id && a.status === "VISIBLE")
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return (
          <li key={q.id} className="rounded-lg border border-line bg-paper-raised p-5">
            {q.status === "HIDDEN" ? (
              <p className="mb-2 text-sm font-semibold text-lacquer">
                Hidden by a moderator{q.statusReason ? `: ${q.statusReason}` : ""}
              </p>
            ) : null}
            <p className="text-sm text-ink-soft">
              {product ? (
                <Link
                  href={`/p/${product.slug}#q-${q.id}`}
                  className="font-semibold text-forest underline underline-offset-4"
                >
                  {product.title}
                </Link>
              ) : (
                "An item no longer listed"
              )}
              , {formatDate(q.createdAt)}
            </p>
            <p className="mt-2 font-medium [overflow-wrap:anywhere]">{q.body}</p>
            {answers.length ? (
              answers.map((a) => (
                <p key={a.id} className="mt-3 border-l-2 border-forest pl-4 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{a.authorRole === "ADMIN" ? "CeyLiving team: " : "Seller: "}</span>
                  {a.body}
                </p>
              ))
            ) : (
              <p className="mt-3 text-sm text-ink-soft">Waiting for an answer. We’ll notify you.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function MyQuestionsPage() {
  return (
    <>
      <PageTitle title="My questions" />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <MyQuestions />
      </Suspense>
    </>
  );
}
