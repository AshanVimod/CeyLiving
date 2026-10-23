import "server-only";
import type { ProductAnswer, ProductQuestion } from "@/lib/types";
import type { AnswerInput, QuestionInput } from "@/lib/validation/content";
import { ForbiddenError, NotFoundError } from "../errors";
import { isProductPublic } from "../repositories/catalogue";
import { assertCanPost, assertShopOwner, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { transaction, type StoreData } from "../store/dev-store";
import { assertRateLimit } from "./shared";

/**
 * RULE-Q1: any signed-in person who may post can ask about an item on sale, except about their own shop's items.
 * Limited to 5 questions an hour (SEC-A6). Contact details are blocked by the schema (RULE-Q4).
 */
export async function askQuestion(actor: Actor, input: QuestionInput, now = new Date()): Promise<ProductQuestion> {
  assertCanPost(actor, now);
  return transaction((db) => {
    const product = db.products.find((p) => p.id === input.productId);
    if (!product || !isProductPublic(product, db)) throw new NotFoundError("This item isn’t available.");
    const shop = db.shops.find((s) => s.slug === product.shopSlug)!;
    if (shop.ownerId === actor.id) throw new ForbiddenError("You can’t ask questions about your own items.");
    assertRateLimit(db, actor.id, "question", now);
    const question: ProductQuestion = {
      id: newId("q"),
      productId: product.id,
      shopId: shop.id,
      authorId: actor.id,
      authorName: actor.name,
      body: input.body,
      status: "VISIBLE",
      createdAt: now.toISOString(),
    };
    db.questions.push(question);
    addNotification(db, shop.ownerId, "question.created", `New question about ${product.title}`, "/seller/questions"); // RULE-Q3
    return question;
  });
}

/** RULE-Q2: only the item's seller, or an admin (shown as the CeyLiving team), can answer. Customers never can. */
export async function answerQuestion(actor: Actor, input: AnswerInput, now = new Date()): Promise<ProductAnswer> {
  assertCanPost(actor, now);
  return transaction((db) => addAnswer(db, actor, input, now));
}

/** The answer itself, inside the caller's transaction (also used for "Reply as CeyLiving"). */
export function addAnswer(db: StoreData, actor: Actor, input: AnswerInput, now = new Date()): ProductAnswer {
  const question = db.questions.find((q) => q.id === input.questionId);
  if (!question || question.status === "DELETED") throw new NotFoundError("Question not found.");
  if (actor.role !== "ADMIN") assertShopOwner(actor, question.shopId, db);
  assertRateLimit(db, actor.id, "answer", now);
  const answer: ProductAnswer = {
    id: newId("a"),
    questionId: question.id,
    authorId: actor.id,
    authorRole: actor.role === "ADMIN" ? "ADMIN" : "SELLER",
    body: input.body,
    status: "VISIBLE",
    createdAt: now.toISOString(),
  };
  db.answers.push(answer);
  const product = db.products.find((p) => p.id === question.productId);
  addNotification(
    db,
    question.authorId,
    "question.answered",
    `Your question about ${product?.title ?? "an item"} was answered`,
    `/p/${product?.slug ?? ""}#q-${question.id}`,
  ); // RULE-Q3
  return answer;
}
