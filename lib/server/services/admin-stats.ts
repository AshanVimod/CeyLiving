import "server-only";
import { AUTO_HIDE_REPORT_THRESHOLD } from "@/lib/config";
import { db, type Tx } from "../db/tx";
import { listProducts, listShops } from "../repositories/catalogue";
import { listAnswers, listQuestions, listReports, listReviews } from "../repositories/content";
import { listApplications } from "../repositories/people";

/** Counts for the admin dashboard and the admin's profile card (FR-15). */
export async function adminCounts(tx: Tx = db) {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const openReports = (await listReports(tx)).filter((r) => r.status === "OPEN");
  const flaggedTargets = new Set(openReports.map((r) => `${r.targetType}:${r.targetId}`));
  const posts = [...(await listReviews(tx)), ...(await listQuestions(tx)), ...(await listAnswers(tx))];
  return {
    pendingApplications: (await listApplications(tx)).filter((a) => a.status === "PENDING").length,
    pendingProducts: (await listProducts(tx)).filter((p) => p.status === "PENDING_REVIEW").length,
    openReports: openReports.length,
    flaggedContent: flaggedTargets.size,
    autoHidden: posts.filter((c) => c.status === "HIDDEN" && c.statusReason?.startsWith("Hidden automatically")).length,
    newShopsThisWeek: (await listShops(tx)).filter((s) => Date.parse(s.createdAt) >= weekAgo).length,
    threshold: AUTO_HIDE_REPORT_THRESHOLD,
  };
}

export async function adminWaitingTotal(tx: Tx = db): Promise<number> {
  const c = await adminCounts(tx);
  return c.pendingApplications + c.pendingProducts + c.openReports;
}
