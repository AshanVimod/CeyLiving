// @vitest-environment node
import { describe, expect, it } from "vitest";
import { questionSchema } from "@/lib/validation/content";
import { findContactDetails } from "@/lib/validation/contact";
import { withTestStore, user } from "@/test/store-helpers";
import { getPublicProduct } from "../catalogue";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError } from "../errors";
import { canPost } from "../permissions";
import { readStore } from "../store/dev-store";
import { moderateContent, officialReply, reportContent, resolveReport, restrictUser } from "./moderation";
import { markNotificationsRead, myNotifications } from "./notifications";
import { answerQuestion, askQuestion } from "./questions";

withTestStore();

const naga = () => getPublicProduct("naga-raksha-mask")!;
const vase = () => getPublicProduct("terracotta-vase-trio")!;

describe("FR-3b questions", () => {
  it("RULE-Q1 a signed-in customer can ask; the seller is notified (RULE-Q3)", async () => {
    const q = await askQuestion(user("user_customer"), {
      productId: naga().id,
      body: "Does it come with a hanging hook?",
    });
    expect(q.status).toBe("VISIBLE");
    expect(readStore().notifications.some((n) => n.userId === "user_seller" && n.type === "question.created")).toBe(
      true,
    );
  });

  it("RULE-Q1 a seller can't ask about their own item", async () => {
    await expect(
      askQuestion(user("user_seller"), { productId: naga().id, body: "Is this a real question?" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("RULE-Q1 limits questions to 5 an hour", async () => {
    for (let i = 0; i < 5; i++)
      await askQuestion(user("user_customer"), { productId: vase().id, body: `Question number ${i} about glaze?` });
    await expect(
      askQuestion(user("user_customer"), { productId: vase().id, body: "One question too many today?" }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("RULE-Q2 customers and other sellers can't answer; the shop's seller and admins can", async () => {
    const q = readStore().questions.find((x) => x.id === "q_gurulu_colour")!;
    await expect(
      answerQuestion(user("user_customer"), { questionId: q.id, body: "I think they are painted." }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      answerQuestion(user("user_owner_galle-beeralu-studio"), { questionId: q.id, body: "Painted." }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const answer = await answerQuestion(user("user_seller"), {
      questionId: q.id,
      body: "Painted by hand, no real feathers.",
    });
    expect(answer.authorRole).toBe("SELLER");
    await officialReply(user("user_admin"), {
      targetType: "QUESTION",
      targetId: q.id,
      body: "CeyLiving checked: the wings are painted.",
    });
    expect(readStore().answers.some((a) => a.questionId === q.id && a.authorRole === "ADMIN")).toBe(true);
    expect(readStore().notifications.some((n) => n.userId === q.authorId && n.type === "question.answered")).toBe(true);
  });

  it("RULE-Q4 questions with phone numbers, emails or links are refused with a clear message", () => {
    for (const body of [
      "Call me on 0771234567 please",
      "Email me at ruwan@example.lk",
      "See www.example.com for my shop",
      "my number is +94 77 123 4567",
    ]) {
      const result = questionSchema.safeParse({ productId: "prod_x", body });
      expect(result.success, body).toBe(false);
      expect(result.error!.issues[0]!.message).toMatch(/stay on CeyLiving/);
    }
    expect(findContactDetails("Is the 30 cm size 2 kg or less?")).toBeUndefined();
  });

  it("RULE-M3 a muted customer can't ask", async () => {
    await expect(
      askQuestion(user("user_muted"), { productId: naga().id, body: "Can I ask while muted?" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("FR-5 / FR-8 reports and moderation", () => {
  it("FR-8 one open report per person per target", async () => {
    const input = { targetType: "QUESTION" as const, targetId: "q_naga_size", reason: "Spam or advertising" as const };
    await reportContent(user("user_muted"), input);
    await expect(reportContent(user("user_muted"), input)).rejects.toBeInstanceOf(ConflictError);
  });

  it("RULE-M4 content is hidden automatically at 3 open reports", async () => {
    const input = { targetType: "QUESTION" as const, targetId: "q_naga_size", reason: "Offensive or abusive" as const };
    for (const id of ["user_muted", "user_applicant", "user_seller"]) await reportContent(user(id), input);
    expect(readStore().questions.find((q) => q.id === "q_naga_size")!.status).toBe("HIDDEN");
  });

  it("RULE-M1 only admins hide content; each action needs a reason and leaves an audit row", async () => {
    const target = { targetType: "QUESTION" as const, targetId: "q_naga_size" };
    await expect(
      moderateContent(user("user_seller"), { ...target, action: "hide", reason: "Not allowed here." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await moderateContent(user("user_admin"), { ...target, action: "hide", reason: "Off-topic question." });
    await moderateContent(user("user_admin"), { ...target, action: "restore", reason: "" });
    await moderateContent(user("user_admin"), { ...target, action: "delete", reason: "Contains personal data." });
    const db = readStore();
    expect(db.questions.find((q) => q.id === "q_naga_size")).toMatchObject({ status: "DELETED", body: "" });
    expect(db.auditLog.map((a) => a.action)).toEqual(
      expect.arrayContaining(["content.hide", "content.restore", "content.delete"]),
    );
  });

  it("FR-5 hiding resolves open reports on that content", async () => {
    await reportContent(user("user_muted"), {
      targetType: "QUESTION",
      targetId: "q_naga_size",
      reason: "Something else",
    });
    await moderateContent(user("user_admin"), {
      targetType: "QUESTION",
      targetId: "q_naga_size",
      action: "hide",
      reason: "Off-topic question.",
    });
    expect(readStore().reports.every((r) => r.status === "RESOLVED")).toBe(true);
  });

  it("RULE-M5 an admin can't mute or ban another admin or themselves", async () => {
    await expect(
      restrictUser(user("user_admin"), { userId: "user_admin", action: "ban", reason: "Testing self-ban." }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("RULE-M3 mute blocks posting but not buying; lift restores it; all audited", async () => {
    await restrictUser(user("user_admin"), {
      userId: "user_customer",
      action: "mute",
      days: 7,
      reason: "Repeated spam questions.",
    });
    expect(canPost(user("user_customer"))).toBe(false);
    expect(readStore().orders.some((o) => o.customerId === "user_customer")).toBe(true);
    await restrictUser(user("user_admin"), {
      userId: "user_customer",
      action: "lift",
      reason: "Agreed to the guidelines.",
    });
    expect(canPost(user("user_customer"))).toBe(true);
    expect(readStore().auditLog.filter((a) => a.targetId === "user_customer").length).toBe(2);
  });

  it("reports can be dismissed with a reason", async () => {
    const report = await reportContent(user("user_muted"), {
      targetType: "PRODUCT",
      targetId: naga().id,
      reason: "Counterfeit or copied design",
    });
    await resolveReport(user("user_admin"), {
      reportId: report.id,
      status: "DISMISSED",
      resolution: "Original work, confirmed with the maker.",
    });
    expect(readStore().reports.find((r) => r.id === report.id)!.status).toBe("DISMISSED");
  });
});

describe("FR-11 notifications", () => {
  it("RULE-N1 people only read and mark their own notifications", async () => {
    expect(myNotifications(user("user_customer")).unread).toBe(1);
    await markNotificationsRead(user("user_seller"), ["notif_seed_shipped"]);
    expect(myNotifications(user("user_customer")).unread).toBe(1);
    await markNotificationsRead(user("user_customer"));
    expect(myNotifications(user("user_customer")).unread).toBe(0);
  });
});
