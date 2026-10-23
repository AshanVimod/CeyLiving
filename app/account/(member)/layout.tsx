import type { Metadata } from "next";
import { db } from "@/lib/server/db/tx";
import { Suspense } from "react";
import { accountNavItems } from "@/components/account/account-nav";
import { AreaShell, AreaSkeleton } from "@/components/account/area-shell";
import { requireUser } from "@/lib/server/auth";
import { notificationsOf } from "@/lib/server/repositories/people";

export const metadata: Metadata = { robots: { index: false } };

// Signed-in areas wait for the session and may redirect, so navigations into them are allowed to block.
export const instant = false;

async function MemberShell({ children }: { children: React.ReactNode }) {
  // SEC-A1: the layout checks the session on the server; each page checks again for its own path.
  const user = await requireUser("/account");
  const unread = (await notificationsOf(db, user.id)).filter((n) => !n.readAt).length;
  return (
    <AreaShell title="My account" navLabel="Account" items={accountNavItems(unread)} exact={["/account"]}>
      {children}
    </AreaShell>
  );
}

export default function MemberLayout({ children }: LayoutProps<"/account">) {
  return (
    <Suspense fallback={<AreaSkeleton />}>
      <MemberShell>{children}</MemberShell>
    </Suspense>
  );
}
