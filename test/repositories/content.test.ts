// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as contentRepo from "@/lib/server/repositories/content";
import { ConflictError } from "@/lib/server/errors";
import { buildSeed, type SeedData } from "@/prisma/seed-data";
import type { ProductAnswer, ProductQuestion, Report, Review } from "@/lib/types";
import { byId, repositoryBackend, isNewestFirst } from "./backends";

// Reviews, questions, answers, reports and helpful votes: the same suite on both backends, then what only
// PostgreSQL guarantees.

const { backends, pg } = await repositoryBackend(contentRepo);

/** Test posts on a real seed product, written by real seed users. */
function fixtures(seed: SeedData) {
  const product = seed.products.find((p) => p.shopSlug === "ambalangoda-mask-house")!;
  const shopId = seed.shops.find((s) => s.slug === product.shopSlug)!.id;
  const review = (id: string, authorId: string, createdAt: string): Review => ({
    id,
    productId: product.id,
    shopId,
    authorId,
    authorName: `Name of ${authorId}`,
    rating: 4,
    comment: "Lovely work.",
    status: "VISIBLE",
    createdAt,
  });
  const question = (id: string, authorId: string, createdAt: string): ProductQuestion => ({
    id,
    productId: product.id,
    shopId,
    authorId,
    authorName: `Name of ${authorId}`,
    body: "Is it painted by hand?",
    status: "VISIBLE",
    createdAt,
  });
  const answer = (id: string, questionId: string, createdAt: string): ProductAnswer => ({
    id,
    questionId,
    authorId: "user_seller",
    authorRole: "SELLER",
    body: "Yes, every one.",
    status: "VISIBLE",
    createdAt,
  });
  const report = (id: string, reporterId: string, targetId: string): Report => ({
    id,
    reporterId,
    targetType: "REVIEW",
    targetId,
    reason: "spam",
    status: "OPEN",
    createdAt: "2026-10-25T10:00:00.000Z",
  });
  return { product, shopId, review, question, answer, report };
}

for (const [name, backend] of backends) {
  describe(`content repository contract: ${name}`, () => {
    const { repo, db, withTx, reset } = backend!;
    let seed: SeedData;
    let f: ReturnType<typeof fixtures>;
    beforeEach(async () => {
      seed = await reset();
      f = fixtures(seed);
    });

    it("BE-01 returns the stored reviews as domain objects", async () => {
      expect(byId(await repo.listReviews(db))).toEqual(byId(seed.reviews));
      const withItem = seed.reviews.find((r) => r.orderItemId);
      if (withItem) {
        expect(await repo.reviewForOrderItem(db, withItem.orderItemId!)).toEqual(withItem);
        expect(await repo.reviewedOrderItemIds(db)).toEqual(
          new Set(seed.reviews.flatMap((r) => (r.orderItemId ? [r.orderItemId] : []))),
        );
      }
      expect(await repo.findReview(db, "rev_nobody")).toBeUndefined();
    });

    it("FR-3a lists a product's, a shop's and an author's reviews newest first, and only visible ones publicly", async () => {
      await withTx(async (tx) => {
        await repo.insertReview(tx, f.review("rev_old", "user_customer", "2026-10-01T10:00:00.000Z"));
        await repo.insertReview(tx, {
          ...f.review("rev_new", "user_muted", "2026-10-02T10:00:00.000Z"),
          status: "HIDDEN",
        });
      });
      const ofProduct = await repo.reviewsOfProduct(db, f.product.id);
      expect(isNewestFirst(ofProduct)).toBe(true);
      expect(ofProduct.map((r) => r.id)).toEqual(expect.arrayContaining(["rev_old", "rev_new"]));
      const visible = await repo.visibleReviewsOfProduct(db, f.product.id);
      expect(visible.map((r) => r.id)).toContain("rev_old");
      expect(visible.map((r) => r.id)).not.toContain("rev_new");
      expect(isNewestFirst(await repo.reviewsOfShop(db, f.shopId))).toBe(true);
      expect((await repo.reviewsByAuthor(db, "user_muted")).map((r) => r.id)).toEqual(["rev_new"]);
      expect(await repo.findReview(db, "rev_old")).toEqual(
        f.review("rev_old", "user_customer", "2026-10-01T10:00:00.000Z"),
      );
    });

    it("RULE-R2 / RULE-R3 an edit and a seller reply update the review; a field set to undefined is cleared", async () => {
      await withTx((tx) => repo.insertReview(tx, f.review("rev_1", "user_customer", "2026-10-01T10:00:00.000Z")));
      const replied = await withTx((tx) =>
        repo.updateReview(tx, "rev_1", {
          rating: 5,
          comment: undefined,
          editedAt: "2026-10-03T10:00:00.000Z",
          sellerReply: "Thank you!",
          sellerRepliedAt: "2026-10-04T10:00:00.000Z",
        }),
      );
      expect(replied).toMatchObject({ rating: 5, sellerReply: "Thank you!", editedAt: "2026-10-03T10:00:00.000Z" });
      expect(replied?.comment).toBeUndefined();
      expect(await repo.findReview(db, "rev_1")).toEqual(replied);
      expect(await withTx((tx) => repo.updateReview(tx, "rev_nobody", { rating: 1 }))).toBeUndefined();
    });

    it("RULE-Q2 lists questions newest first and their answers oldest first", async () => {
      await withTx(async (tx) => {
        await repo.insertQuestion(tx, f.question("q_old", "user_customer", "2026-10-01T10:00:00.000Z"));
        await repo.insertQuestion(tx, f.question("q_new", "user_muted", "2026-10-02T10:00:00.000Z"));
        await repo.insertAnswer(tx, f.answer("a_late", "q_old", "2026-10-05T10:00:00.000Z"));
        await repo.insertAnswer(tx, f.answer("a_early", "q_old", "2026-10-03T10:00:00.000Z"));
      });
      const ofProduct = await repo.questionsOfProduct(db, f.product.id);
      expect(isNewestFirst(ofProduct)).toBe(true);
      expect(ofProduct.map((q) => q.id).filter((id) => id === "q_new" || id === "q_old")).toEqual(["q_new", "q_old"]);
      expect(isNewestFirst(await repo.questionsOfShop(db, f.shopId))).toBe(true);
      const mine = (await repo.questionsByAuthor(db, "user_customer")).map((q) => q.id);
      expect(mine).toContain("q_old");
      expect(mine).not.toContain("q_new");
      expect((await repo.answersOf(db, "q_old")).map((a) => a.id)).toEqual(["a_early", "a_late"]);
      expect(await repo.findQuestion(db, "q_old")).toEqual(
        f.question("q_old", "user_customer", "2026-10-01T10:00:00.000Z"),
      );
      expect(await repo.findAnswer(db, "a_late")).toEqual(f.answer("a_late", "q_old", "2026-10-05T10:00:00.000Z"));
      expect(byId(await repo.listQuestions(db)).map((q) => q.id)).toEqual(
        byId([...seed.questions, ...ofProduct.filter((q) => q.id === "q_new" || q.id === "q_old")]).map((q) => q.id),
      );
      expect((await repo.listAnswers(db)).map((a) => a.id)).toEqual(expect.arrayContaining(["a_early", "a_late"]));
    });

    it("RULE-M1 / RULE-M2 moderation hides and restores a post, and deleting erases its text", async () => {
      await withTx(async (tx) => {
        await repo.insertReview(tx, {
          ...f.review("rev_m", "user_customer", "2026-10-01T10:00:00.000Z"),
          sellerReply: "Thanks",
        });
        await repo.insertQuestion(tx, f.question("q_m", "user_customer", "2026-10-01T10:00:00.000Z"));
      });
      await withTx((tx) => repo.updateContent(tx, "REVIEW", "rev_m", { status: "HIDDEN", statusReason: "Off-topic" }));
      expect(await repo.findContent(db, "REVIEW", "rev_m")).toMatchObject({
        status: "HIDDEN",
        statusReason: "Off-topic",
      });

      await withTx((tx) => repo.updateContent(tx, "REVIEW", "rev_m", { status: "VISIBLE", statusReason: undefined }));
      expect((await repo.findReview(db, "rev_m"))?.statusReason).toBeUndefined();

      await withTx((tx) =>
        repo.updateContent(tx, "REVIEW", "rev_m", {
          status: "DELETED",
          statusReason: "Personal data",
          comment: undefined,
          sellerReply: undefined,
          ceylivingReply: undefined,
        }),
      );
      const erased = await repo.findReview(db, "rev_m");
      expect(erased).toMatchObject({ status: "DELETED", rating: 4 });
      expect([erased?.comment, erased?.sellerReply]).toEqual([undefined, undefined]);

      await withTx((tx) =>
        repo.updateContent(tx, "QUESTION", "q_m", { status: "DELETED", statusReason: "x", body: "" }),
      );
      expect(await repo.findContent(db, "QUESTION", "q_m")).toMatchObject({ status: "DELETED", body: "" });
      expect(await repo.findContent(db, "ANSWER", "a_nobody")).toBeUndefined();
    });

    it("FR-17 renames an anonymised author on their own reviews and questions only, keeping their id", async () => {
      await withTx(async (tx) => {
        await repo.insertReview(tx, f.review("rev_a", "user_customer", "2026-10-01T10:00:00.000Z"));
        await repo.insertQuestion(tx, f.question("q_a", "user_customer", "2026-10-01T10:00:00.000Z"));
        await repo.insertReview(tx, f.review("rev_b", "user_muted", "2026-10-01T10:00:00.000Z"));
      });
      await withTx((tx) => repo.renameAuthorOnPosts(tx, "user_customer", "Former customer"));

      const reviews = await repo.reviewsByAuthor(db, "user_customer");
      const questions = await repo.questionsByAuthor(db, "user_customer");
      expect(reviews.length).toBeGreaterThan(0);
      expect([...reviews, ...questions].every((p) => p.authorName === "Former customer")).toBe(true);
      expect([...reviews, ...questions].every((p) => p.authorId === "user_customer")).toBe(true);
      expect((await repo.findReview(db, "rev_b"))?.authorName).toBe("Name of user_muted");
    });

    it("FR-8 lists open reports per target and closes them only while open", async () => {
      await withTx(async (tx) => {
        await repo.insertReview(tx, f.review("rev_r", "user_customer", "2026-10-01T10:00:00.000Z"));
        await repo.insertReport(tx, f.report("rep_1", "user_muted", "rev_r"));
        await repo.insertReport(tx, f.report("rep_2", "user_seller", "rev_r"));
      });
      expect((await repo.openReportsFor(db, "REVIEW", "rev_r")).map((r) => r.id).sort()).toEqual(["rep_1", "rep_2"]);
      expect((await repo.reportsByReporter(db, "user_muted")).map((r) => r.id)).toContain("rep_1");
      expect(isNewestFirst(await repo.listReports(db))).toBe(true);

      const dismissed = await withTx((tx) =>
        repo.updateOpenReport(tx, "rep_1", { status: "DISMISSED", resolvedById: "user_admin", resolution: "Fine" }),
      );
      expect(dismissed).toMatchObject({ status: "DISMISSED", resolvedById: "user_admin" });
      expect(await withTx((tx) => repo.updateOpenReport(tx, "rep_1", { status: "RESOLVED" }))).toBeUndefined();

      await withTx((tx) =>
        repo.resolveOpenReportsFor(tx, "REVIEW", "rev_r", {
          status: "RESOLVED",
          resolvedById: "user_admin",
          resolution: "hide",
        }),
      );
      expect(await repo.openReportsFor(db, "REVIEW", "rev_r")).toEqual([]);
      expect((await repo.findReport(db, "rep_1"))?.status).toBe("DISMISSED");
      expect((await repo.findReport(db, "rep_2"))?.status).toBe("RESOLVED");
    });

    it("FR-19 adds, counts and removes helpful votes", async () => {
      await withTx(async (tx) => {
        await repo.insertReview(tx, f.review("rev_v", "user_customer", "2026-10-01T10:00:00.000Z"));
        await repo.insertVote(tx, {
          userId: "user_muted",
          targetType: "REVIEW",
          targetId: "rev_v",
          createdAt: "2026-10-02T10:00:00.000Z",
        });
        await repo.insertVote(tx, {
          userId: "user_seller",
          targetType: "REVIEW",
          targetId: "rev_v",
          createdAt: "2026-10-03T10:00:00.000Z",
        });
      });
      expect(await repo.countVotes(db, "REVIEW", "rev_v")).toBe(2);
      expect((await repo.votesFor(db, "REVIEW", ["rev_v", "rev_other"])).map((v) => v.userId).sort()).toEqual([
        "user_muted",
        "user_seller",
      ]);
      expect(await repo.votesFor(db, "QUESTION", ["rev_v"])).toEqual([]);

      expect(await withTx((tx) => repo.deleteVote(tx, "user_muted", "REVIEW", "rev_v"))).toBe(true);
      expect(await withTx((tx) => repo.deleteVote(tx, "user_muted", "REVIEW", "rev_v"))).toBe(false);
      await withTx((tx) => repo.deleteVotesOf(tx, "user_seller"));
      expect(await repo.countVotes(db, "REVIEW", "rev_v")).toBe(0);
    });

    it("BE-03 the shared read handle refuses writes", async () => {
      await expect(repo.deleteVotesOf(db, "user_customer")).rejects.toThrow("withTx");
    });
  });
}

describe("content (PostgreSQL only)", () => {
  const { handles } = pg;
  let f: ReturnType<typeof fixtures>;
  beforeEach(async () => {
    const seed = buildSeed(new Date());
    await pg.reset(seed);
    f = fixtures(seed);
    await handles.withTx((tx) =>
      contentRepo.insertReview(tx, f.review("rev_p", "user_customer", "2026-10-01T10:00:00.000Z")),
    );
  });

  it("FR-8 a second open report on the same post by the same person reads as a plain conflict", async () => {
    await handles.withTx((tx) => contentRepo.insertReport(tx, f.report("rep_a", "user_muted", "rev_p")));
    const again = handles.withTx((tx) => contentRepo.insertReport(tx, f.report("rep_b", "user_muted", "rev_p")));
    await expect(again).rejects.toBeInstanceOf(ConflictError);
    await expect(again).rejects.toThrow("You’ve already reported this.");
  });

  it("FR-19 a second helpful vote by the same person reads as a plain conflict", async () => {
    const vote = {
      userId: "user_muted",
      targetType: "REVIEW" as const,
      targetId: "rev_p",
      createdAt: "2026-10-02T10:00:00.000Z",
    };
    await handles.withTx((tx) => contentRepo.insertVote(tx, vote));
    await expect(handles.withTx((tx) => contentRepo.insertVote(tx, vote))).rejects.toThrow(
      "You’ve already marked this as helpful.",
    );
  });

  it("RULE-R1 the database refuses a second review of the same order item", async () => {
    const seed = buildSeed(new Date());
    const item = seed.orderItems.find((i) => !seed.reviews.some((r) => r.orderItemId === i.id))!;
    const first = { ...f.review("rev_i1", "user_customer", "2026-10-01T10:00:00.000Z"), orderItemId: item.id };
    await handles.withTx((tx) => contentRepo.insertReview(tx, first));
    const again = handles.withTx((tx) => contentRepo.insertReview(tx, { ...first, id: "rev_i2" }));
    await expect(again).rejects.toThrow("You’ve already reviewed this item.");
  });

  it("DB-07 the database refuses a rating outside 1 to 5", async () => {
    await expect(
      handles.withTx((tx) =>
        contentRepo.insertReview(tx, { ...f.review("rev_6", "user_muted", "2026-10-01T10:00:00.000Z"), rating: 6 }),
      ),
    ).rejects.toThrow();
  });

  it("RULE-M1 moderation can only set status, reason and erased text; any other field is refused", async () => {
    await expect(
      handles.withTx((tx) => contentRepo.updateContent(tx, "REVIEW", "rev_p", { status: "HIDDEN", rating: 1 })),
    ).rejects.toThrow("cannot set rating");
    expect((await contentRepo.findReview(handles.db, "rev_p"))?.status).toBe("VISIBLE");
  });
});
