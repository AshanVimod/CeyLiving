import "server-only";
import type { ProductAnswer, ProductQuestion } from "@/lib/types";
import type { AnswerInput, QuestionInput } from "@/lib/validation/content";
import { withTx, type Tx } from "../db/tx";
import { ForbiddenError, NotFoundError } from "../errors";
import { findProductById, findShopBySlug, isProductPublic } from "../repositories/catalogue";
import { findQuestion, insertAnswer, insertQuestion } from "../repositories/content";
import { assertCanPost, assertShopOwner, type Actor } from "../permissions";
import { addNotification, newId } from "../repositories/people";
import { assertRateLimit } from "./shared";

/**
 * RULE-Q1: any signed-in person who may post can ask about an item on sale, except about their own shop's items.
 * Limited to 5 questions an hour (SEC-A6). Contact details are blocked by the schema (RULE-Q4).
 */
export async function askQuestion(actor: Actor, input: QuestionInput, now = new Date()): Promise<ProductQuestion> {
  assertCanPost(actor, now);
  return withTx(async (tx) => {
    const product = await findProductById(tx, input.productId);
    if (!product || !(await isProductPublic(tx, product))) throw new NotFoundError("This item isn’t available.");
    const shop = (await findShopBySlug(tx, product.shopSlug))!;
    if (shop.ownerId === actor.id) throw new ForbiddenError("You can’t ask questions about your own items.");
    await assertRateLimit(tx, actor.id, "question", now);
    const question = await insertQuestion(tx, {
      id: newId("q"),
      productId: product.id,
      shopId: shop.id,
      authorId: actor.id,
      authorName: actor.name,
      body: input.body,
      status: "VISIBLE",
      createdAt: now.toISOString(),
    });
    await addNotification(
      tx,
      shop.ownerId,
      "question.created",
      `New question about ${product.title}`,
      "/seller/questions",
    ); // RULE-Q3
    return question;
  });
}

/** RULE-Q2: only the item's seller, or an admin (shown as the CeyLiving team), can answer. Customers never can. */
export async function answerQuestion(actor: Actor, input: AnswerInput, now = new Date()): Promise<ProductAnswer> {
  assertCanPost(actor, now);
  return withTx((tx) => addAnswer(tx, actor, input, now));
}

/** The answer itself, inside the caller's transaction (also used for "Reply as CeyLiving"). */
export async function addAnswer(tx: Tx, actor: Actor, input: AnswerInput, now = new Date()): Promise<ProductAnswer> {
  const question = await findQuestion(tx, input.questionId);
  if (!question || question.status === "DELETED") throw new NotFoundError("Question not found.");
  if (actor.role !== "ADMIN") await assertShopOwner(actor, question.shopId, tx);
  await assertRateLimit(tx, actor.id, "answer", now);
  const answer = await insertAnswer(tx, {
    id: newId("a"),
    questionId: question.id,
    authorId: actor.id,
    authorRole: actor.role === "ADMIN" ? "ADMIN" : "SELLER",
    body: input.body,
    status: "VISIBLE",
    createdAt: now.toISOString(),
  });
  const product = await findProductById(tx, question.productId);
  await addNotification(
    tx,
    question.authorId,
    "question.answered",
    `Your question about ${product?.title ?? "an item"} was answered`,
    `/p/${product?.slug ?? ""}#q-${question.id}`,
  ); // RULE-Q3
  return answer;
}
