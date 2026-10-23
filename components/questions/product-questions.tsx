import Link from "next/link";
import { db } from "@/lib/server/db/tx";
import { formatDate } from "@/lib/format";
import { currentUser } from "@/lib/server/auth";
import { canPost } from "@/lib/server/permissions";
import { answersOf, questionsOfProduct } from "@/lib/server/repositories/content";
import type { Shop } from "@/lib/types";
import { byHelpfulness, helpfulCounts } from "@/lib/server/services/community-extras";
import { ReportButton } from "../moderation/report-button";
import { HelpfulButton } from "../reviews/helpful-button";
import { AnswerForm, AskQuestionForm } from "./question-forms";

/**
 * FR-3b: "Questions about this item". Everyone reads the thread; signed-in customers ask;
 * only this shop's seller or an admin can answer (RULE-Q2). Hidden posts are shown only to their author.
 */
export async function ProductQuestions({
  productId,
  productSlug,
  shop,
}: {
  productId: string;
  productSlug: string;
  shop: Shop;
}) {
  const user = await currentUser();
  const isOwner = user?.id === shop.ownerId;
  const isAdmin = user?.role === "ADMIN";
  const listed = (await questionsOfProduct(db, productId)).filter(
    (q) => q.status === "VISIBLE" || (q.status === "HIDDEN" && q.authorId === user?.id),
  );
  const { counts, mine } = await helpfulCounts(
    "QUESTION",
    listed.map((q) => q.id),
    user?.id,
  );
  const questions = byHelpfulness(listed, counts); // FR-19: most useful first
  const answersByQuestion = new Map(
    await Promise.all(questions.map(async (q) => [q.id, await answersOf(db, q.id)] as const)),
  );

  return (
    <section id="questions" aria-labelledby="questions-heading" className="mt-20 scroll-mt-40">
      <h2 id="questions-heading" className="text-[1.85rem]">
        Questions about this item
      </h2>
      <p className="mt-2 max-w-prose text-ink-soft">Answered by {shop.name}. Questions and answers are public.</p>

      {questions.length ? (
        <ul className="mt-6 space-y-5">
          {questions.map((q) => {
            const answers = answersByQuestion.get(q.id)!.filter((a) => a.status === "VISIBLE");
            return (
              <li key={q.id} id={`q-${q.id}`} className="scroll-mt-40 border-t border-line pt-5">
                {q.status === "HIDDEN" ? (
                  <p className="mb-2 text-sm font-semibold text-lacquer">
                    Hidden by a moderator. Only you can see this.
                  </p>
                ) : null}
                <p className="font-medium [overflow-wrap:anywhere]">{q.body}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                  <span>
                    {q.authorName}, {formatDate(q.createdAt)}
                  </span>
                  {q.status === "VISIBLE" ? (
                    <ReportButton targetType="QUESTION" targetId={q.id} label="this question" />
                  ) : null}
                </div>
                {q.status === "VISIBLE" ? (
                  <div className="mt-2">
                    <HelpfulButton
                      targetType="QUESTION"
                      targetId={q.id}
                      count={counts.get(q.id) ?? 0}
                      voted={mine.has(q.id)}
                      disabled={q.authorId === user?.id}
                    />
                  </div>
                ) : null}
                {answers.map((a) => (
                  <div key={a.id} className="mt-3 border-l-2 border-forest pl-4">
                    <p className="text-sm font-semibold">
                      {a.authorRole === "ADMIN" ? "CeyLiving team" : `${shop.name} (Seller)`}
                    </p>
                    <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{a.body}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                      <span>{formatDate(a.createdAt)}</span>
                      <ReportButton targetType="ANSWER" targetId={a.id} label="this answer" />
                    </div>
                  </div>
                ))}
                {(isOwner || isAdmin) && q.status === "VISIBLE" && user && canPost(user) ? (
                  <details className="mt-3 rounded-md border border-line p-4" open={isOwner && answers.length === 0}>
                    <summary className="cursor-pointer font-semibold text-forest">
                      {isAdmin ? "Answer as CeyLiving" : "Answer this question"}
                    </summary>
                    <div className="mt-3">
                      <AnswerForm questionId={q.id} asTeam={isAdmin} />
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-6 text-ink-soft">No questions yet. Ask the maker about size, materials or delivery.</p>
      )}

      <div className="mt-8 max-w-2xl">
        {!user ? (
          <p>
            <Link
              href={`/signin?next=${encodeURIComponent(`/p/${productSlug}#questions`)}`}
              className="font-semibold text-forest underline underline-offset-4"
            >
              Sign in to ask
            </Link>{" "}
            <span className="text-ink-soft">a question about this item.</span>
          </p>
        ) : isOwner ? (
          <p className="text-ink-soft">This is your item, so you answer questions here rather than ask them.</p>
        ) : !canPost(user) ? (
          <p className="text-ink-soft">Your account can’t post questions right now. You can still buy as usual.</p>
        ) : isAdmin ? null : (
          <section aria-labelledby="ask-h" className="rounded-lg border border-line bg-paper-raised p-5">
            <h3 id="ask-h" className="mb-4 font-sans text-lg font-semibold">
              Ask a question
            </h3>
            <AskQuestionForm productId={productId} />
          </section>
        )}
      </div>
    </section>
  );
}

export function ProductQuestionsSkeleton() {
  return (
    <div className="mt-20 space-y-4" aria-busy="true">
      <div className="skeleton h-9 w-72 rounded-sm" />
      <div className="skeleton h-24 rounded-lg" />
    </div>
  );
}
