import "server-only";
import { AUTO_HIDE_REPORT_THRESHOLD } from "@/lib/config";
import { readStore, type StoreData } from "../store/dev-store";

/** Counts for the admin dashboard and the admin's profile card (FR-15). */
export function adminCounts(db: StoreData = readStore()) {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const openReports = db.reports.filter((r) => r.status === "OPEN");
  const flaggedTargets = new Set(openReports.map((r) => `${r.targetType}:${r.targetId}`));
  return {
    pendingApplications: db.applications.filter((a) => a.status === "PENDING").length,
    pendingProducts: db.products.filter((p) => p.status === "PENDING_REVIEW").length,
    openReports: openReports.length,
    flaggedContent: flaggedTargets.size,
    autoHidden: [...db.reviews, ...db.questions, ...db.answers].filter((c) => c.status === "HIDDEN" && c.statusReason?.startsWith("Hidden automatically")).length,
    newShopsThisWeek: db.shops.filter((s) => Date.parse(s.createdAt) >= weekAgo).length,
    threshold: AUTO_HIDE_REPORT_THRESHOLD,
  };
}

export function adminWaitingTotal(db: StoreData = readStore()): number {
  const c = adminCounts(db);
  return c.pendingApplications + c.pendingProducts + c.openReports;
}
