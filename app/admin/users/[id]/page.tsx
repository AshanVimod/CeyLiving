import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { MakeAdminButton } from "@/components/account/privacy-actions";
import { UserRestrictionActions } from "@/components/admin/user-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { findUserById, listAuditLog } from "@/lib/server/repositories/people";
import { readStore } from "@/lib/server/store/dev-store";

export const metadata = { title: "User" };

async function UserDetail({ params }: { params: PageProps<"/admin/users/[id]">["params"] }) {
  const admin = await requireRole(["ADMIN"], "/admin/users");
  const { id } = await params;
  const db = readStore();
  const user = findUserById(id, db);
  if (!user) notFound();
  const counts = {
    orders: db.orders.filter((o) => o.customerId === user.id).length,
    reviews: db.reviews.filter((r) => r.authorId === user.id).length,
    questions: db.questions.filter((q) => q.authorId === user.id).length,
    reportsMade: db.reports.filter((r) => r.reporterId === user.id).length,
  };
  const history = listAuditLog(db).filter((a) => a.targetId === user.id);
  const shop = db.shops.find((s) => s.ownerId === user.id);
  const protectedUser = user.role === "ADMIN" || user.id === admin.id; // RULE-M5
  return (
    <>
      <p className="mb-3">
        <Link href="/admin/users" className="text-sm font-semibold text-forest underline underline-offset-4">
          All users
        </Link>
      </p>
      <PageTitle title={user.name} description={`${user.email}. ${user.role.charAt(0)}${user.role.slice(1).toLowerCase()} since ${formatDate(user.createdAt)}.`} action={<StatusBadge status={user.postingRestriction} />} />
      {user.postingRestriction !== "NONE" ? (
        <p className="mb-6 rounded-md bg-sage px-4 py-3">
          {user.postingRestriction === "MUTED" && user.mutedUntil ? `Muted until ${formatDate(user.mutedUntil)}. ` : user.postingRestriction === "BANNED" ? "Banned from posting. " : ""}
          {user.restrictionReason ? `Reason: ${user.restrictionReason}` : ""}
        </p>
      ) : null}
      <ul className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries({ Orders: counts.orders, Reviews: counts.reviews, Questions: counts.questions, "Reports made": counts.reportsMade }).map(([k, v]) => (
          <li key={k} className="rounded-lg border border-line bg-paper-raised p-4">
            <span className="block font-display text-3xl tabular-nums">{v}</span>
            <span className="text-sm text-ink-soft">{k}</span>
          </li>
        ))}
      </ul>
      {shop ? (
        <p className="mb-6">
          Shop:{" "}
          <Link href={`/admin/sellers/${shop.id}`} className="font-semibold text-forest underline underline-offset-4">
            {shop.name}
          </Link>
        </p>
      ) : null}
      {user.deletedAt ? <p className="mb-4 rounded-md bg-sage px-4 py-3">This account was deleted on {formatDate(user.deletedAt)}.</p> : null}
      {protectedUser ? (
        <p className="text-ink-soft">Admins can’t mute, ban or change the role of another admin or themselves.</p>
      ) : user.deletedAt ? null : (
        <div className="flex flex-wrap items-start gap-2">
          <UserRestrictionActions userId={user.id} name={user.name} restriction={user.postingRestriction} />
          {user.role === "CUSTOMER" ? <MakeAdminButton userId={user.id} name={user.name} /> : null}
        </div>
      )}
      <h2 className="mt-10 mb-4 text-2xl">History</h2>
      {history.length ? (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.id} className="rounded-md border border-line bg-paper-raised px-4 py-3">
              <span className="font-semibold">{h.action}</span> by {findUserById(h.actorId, db)?.name ?? h.actorId}, {formatDate(h.createdAt)}
              {h.reason ? <span className="block text-ink-soft">Reason: {h.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-soft">No admin actions on this account.</p>
      )}
    </>
  );
}

export default function AdminUserPage(props: PageProps<"/admin/users/[id]">) {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
      <UserDetail params={props.params} />
    </Suspense>
  );
}
