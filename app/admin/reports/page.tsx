import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { FilterLinks } from "@/components/admin/data-table";
import { ReportResolution } from "@/components/admin/user-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { listReports } from "@/lib/server/repositories/content";
import { readStore, type StoreData } from "@/lib/server/store/dev-store";
import type { Report } from "@/lib/types";

export const metadata = { title: "Reports" };

const FILTERS = ["OPEN", "RESOLVED", "DISMISSED"] as const;

/** A short preview of what was reported, with a link to where it lives. */
function preview(r: Report, db: StoreData): { text: string; href?: string } {
  if (r.targetType === "PRODUCT") {
    const p = db.products.find((x) => x.id === r.targetId);
    return { text: p ? `Item: ${p.title}` : "Item (gone)", href: p ? `/admin/products?status=${p.status}` : undefined };
  }
  if (r.targetType === "SHOP") {
    const s = db.shops.find((x) => x.id === r.targetId);
    return { text: s ? `Shop: ${s.name}` : "Shop (gone)", href: s ? `/admin/sellers/${s.id}` : undefined };
  }
  const content =
    r.targetType === "REVIEW"
      ? db.reviews.find((x) => x.id === r.targetId)?.comment
      : r.targetType === "QUESTION"
        ? db.questions.find((x) => x.id === r.targetId)?.body
        : db.answers.find((x) => x.id === r.targetId)?.body;
  return {
    text: `${r.targetType.charAt(0)}${r.targetType.slice(1).toLowerCase()}: “${(content ?? "(erased)").slice(0, 160)}”`,
    href: `/admin/moderation?type=${r.targetType}&filter=reported`,
  };
}

async function Reports({ searchParams }: { searchParams: PageProps<"/admin/reports">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/reports");
  const { status } = await searchParams;
  const current = FILTERS.find((f) => f === status) ?? "OPEN";
  const db = readStore();
  const reports = listReports(db).filter((r) => r.status === current);
  return (
    <>
      <FilterLinks
        current={current}
        items={FILTERS.map((f) => ({
          value: f,
          label: f.charAt(0) + f.slice(1).toLowerCase(),
          href: `/admin/reports?status=${f}`,
        }))}
      />
      {reports.length ? (
        <ul className="space-y-4">
          {reports.map((r) => {
            const p = preview(r, db);
            const reporter = db.users.find((u) => u.id === r.reporterId);
            return (
              <li key={r.id} className="rounded-lg border border-line bg-paper-raised p-5">
                <p className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{r.reason}</span>
                  <StatusBadge status={r.status} />
                </p>
                <p className="mt-2 [overflow-wrap:anywhere]">
                  {p.href ? (
                    <Link href={p.href} className="text-forest underline underline-offset-4">
                      {p.text}
                    </Link>
                  ) : (
                    p.text
                  )}
                </p>
                {r.details ? <p className="mt-2 text-ink-soft [overflow-wrap:anywhere]">“{r.details}”</p> : null}
                <p className="mt-2 text-sm text-ink-soft">
                  Reported by {reporter?.name ?? "Unknown"}, {formatDate(r.createdAt)}
                  {r.resolution ? `. Outcome: ${r.resolution}` : ""}
                </p>
                {r.status === "OPEN" ? (
                  <div className="mt-4">
                    <ReportResolution reportId={r.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No reports" text="Reports from customers appear here." />
      )}
    </>
  );
}

export default function ReportsPage(props: PageProps<"/admin/reports">) {
  return (
    <>
      <PageTitle title="Reports" description="Reports on items, shops, reviews, questions and answers." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Reports searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
