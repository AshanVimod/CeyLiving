import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { AnswerForm } from "@/components/questions/question-forms";
import { formatDate } from "@/lib/format";
import { answersOf, questionsOfShop } from "@/lib/server/repositories/content";
import { sellerContext } from "@/lib/server/seller-context";

export const metadata = { title: "Questions" };

async function Questions() {
  const { shop, db } = await sellerContext("/seller/questions");
  const questions = questionsOfShop(shop.id, db)
    .filter((q) => q.status === "VISIBLE")
    .map((q) => ({ q, answers: answersOf(q.id, db).filter((a) => a.status === "VISIBLE") }))
    .sort((a, b) => Number(a.answers.length > 0) - Number(b.answers.length > 0));
  if (!questions.length)
    return (
      <EmptyState title="No questions yet" text="When customers ask about your items, the questions appear here." />
    );
  return (
    <ul className="space-y-4">
      {questions.map(({ q, answers }) => {
        const product = db.products.find((p) => p.id === q.productId);
        return (
          <li key={q.id} className="rounded-lg border border-line bg-paper-raised p-5">
            <p className="text-sm text-ink-soft">
              {product ? (
                <Link
                  href={`/p/${product.slug}#q-${q.id}`}
                  className="font-semibold text-forest underline underline-offset-4"
                >
                  {product.title}
                </Link>
              ) : null}{" "}
              {q.authorName}, {formatDate(q.createdAt)}
            </p>
            <p className="mt-2 font-medium [overflow-wrap:anywhere]">{q.body}</p>
            {answers.map((a) => (
              <p key={a.id} className="mt-3 border-l-2 border-forest pl-4 text-ink-soft [overflow-wrap:anywhere]">
                <span className="font-semibold text-ink">
                  {a.authorRole === "ADMIN" ? "CeyLiving team: " : "You: "}
                </span>
                {a.body}
              </p>
            ))}
            <details className="mt-4" open={answers.length === 0}>
              <summary className="cursor-pointer font-semibold text-forest">
                {answers.length ? "Add another answer" : "Answer"}
              </summary>
              <div className="mt-3">
                <AnswerForm questionId={q.id} asTeam={false} />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export default function SellerQuestionsPage() {
  return (
    <>
      <PageTitle
        title="Questions"
        description="Unanswered questions come first. Answers appear on the item page for everyone."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Questions />
      </Suspense>
    </>
  );
}
