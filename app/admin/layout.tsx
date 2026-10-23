import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaShell, AreaSkeleton } from "@/components/account/area-shell";
import { requireRole } from "@/lib/server/auth";
import { adminCounts } from "@/lib/server/services/admin-stats";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | CeyLiving admin" },
  robots: { index: false },
};

// Signed-in areas wait for the session and may redirect, so navigations into them are allowed to block.
export const instant = false;

async function AdminShell({ children }: { children: React.ReactNode }) {
  // SEC-A1: customers and sellers are redirected; every admin action checks the role again.
  await requireRole(["ADMIN"], "/admin");
  const c = await adminCounts();
  return (
    <AreaShell
      title="Admin"
      navLabel="Admin"
      exact={["/admin"]}
      items={[
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/applications", label: "Applications", count: c.pendingApplications },
        { href: "/admin/sellers", label: "Sellers" },
        { href: "/admin/products", label: "Items", count: c.pendingProducts },
        { href: "/admin/moderation", label: "Moderation", count: c.flaggedContent },
        { href: "/admin/reports", label: "Reports", count: c.openReports },
        { href: "/admin/users", label: "Users" },
        { href: "/admin/payouts", label: "Payouts" },
        { href: "/admin/audit-log", label: "Audit log" },
      ]}
    >
      {children}
    </AreaShell>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AreaSkeleton />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
