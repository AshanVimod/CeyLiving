import "server-only";
import type { ProductAnswer, ProductQuestion, Report, ReportTargetType, Review } from "@/lib/types";
import { readStore, type StoreData } from "../store/dev-store";

// Reviews, questions, answers and reports.

export function reviewsOfProduct(productId: string, db: StoreData = readStore()): Review[] {
  return db.reviews.filter((r) => r.productId === productId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function visibleReviewsOfProduct(productId: string, db: StoreData = readStore()): Review[] {
  return reviewsOfProduct(productId, db).filter((r) => r.status === "VISIBLE");
}

export function reviewsOfShop(shopId: string, db: StoreData = readStore()): Review[] {
  return db.reviews.filter((r) => r.shopId === shopId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findReview(id: string, db: StoreData = readStore()): Review | undefined {
  return db.reviews.find((r) => r.id === id);
}

export function reviewForOrderItem(orderItemId: string, db: StoreData = readStore()): Review | undefined {
  return db.reviews.find((r) => r.orderItemId === orderItemId);
}

export function questionsOfProduct(productId: string, db: StoreData = readStore()): ProductQuestion[] {
  return db.questions.filter((q) => q.productId === productId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function questionsOfShop(shopId: string, db: StoreData = readStore()): ProductQuestion[] {
  return db.questions.filter((q) => q.shopId === shopId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function questionsByAuthor(authorId: string, db: StoreData = readStore()): ProductQuestion[] {
  return db.questions.filter((q) => q.authorId === authorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findQuestion(id: string, db: StoreData = readStore()): ProductQuestion | undefined {
  return db.questions.find((q) => q.id === id);
}

export function answersOf(questionId: string, db: StoreData = readStore()): ProductAnswer[] {
  return db.answers.filter((a) => a.questionId === questionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function findAnswer(id: string, db: StoreData = readStore()): ProductAnswer | undefined {
  return db.answers.find((a) => a.id === id);
}

export function listReports(db: StoreData = readStore()): Report[] {
  return [...db.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function openReportsFor(targetType: ReportTargetType, targetId: string, db: StoreData = readStore()): Report[] {
  return db.reports.filter((r) => r.targetType === targetType && r.targetId === targetId && r.status === "OPEN");
}

export function findReport(id: string, db: StoreData = readStore()): Report | undefined {
  return db.reports.find((r) => r.id === id);
}
