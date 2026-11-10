import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { requireRole } from "@/lib/server/auth";
import { OperationsCard } from "@/components/admin/operations-card";
import { WorkerStatus } from "@/components/admin/worker-status";
import { adminCounts } from "@/lib/server/services/admin-stats";
import { emailOverview } from "@/lib/server/services/email-admin";
import { operationsOverview } from "@/lib/server/services/ops";

export const metadata = { title: "Dashboard" };

async function Dashboard() {
  const actor = await requireRole(["ADMIN"], "/admin");
  const c = await adminCounts();
  const now = new Date();
  const emails = await emailOverview(actor, now);
  const tiles = [
    { label: "Applications waiting", value: c.pendingApplications, href: "/admin/applications" },
    { label: "Items waiting for approval", value: c.pendingProducts, href: "/admin/products" },
    { label: "Open reports", value: c.openReports, href: "/admin/reports" },
    { label: "Reported posts", value: c.flaggedContent, href: "/admin/moderation?filter=reported" },
    {
      label: `Posts auto-hidden (${c.threshold}+ reports)`,
      value: c.autoHidden,
      href: "/admin/moderation?filter=hidden",
    },
    { label: "New shops this week", value: c.newShopsThisWeek, href: "/admin/sellers" },
    { label: "Emails needing attention", value: emails.items.length, href: "/admin/emails" },
  ];
  return (
    <>
      <PageTitle
        title="Dashboard"
        description="What needs a decision. Every action you take is recorded in the audit log."
      />
      {emails.health.workerSilent && <WorkerStatus health={emails.health} now={now.getTime()} />}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link
              href={t.href}
              className="block h-full rounded-lg border border-line bg-paper-raised p-5 transition-colors hover:border-forest"
            >
              <span className="block font-display text-4xl tabular-nums">{t.value}</span>
              <span className="mt-1 block text-ink-soft">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Suspense fallback={<div className="skeleton mt-10 h-72 rounded-lg" aria-busy="true" />}>
        <Operations />
      </Suspense>
    </>
  );
}

/** B12 (OPS-07): in its own Suspense, so a slow read never holds up the tiles. */
async function Operations() {
  const actor = await requireRole(["ADMIN"], "/admin");
  const now = new Date();
  return <OperationsCard ops={await operationsOverview(actor, now)} now={now.getTime()} />;
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
      <Dashboard />
    </Suspense>
  );
}
