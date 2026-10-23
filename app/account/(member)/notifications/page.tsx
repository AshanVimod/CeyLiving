import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { MarkAllReadButton } from "@/components/account/mark-read-button";
import { requireUser } from "@/lib/server/auth";
import { myNotifications } from "@/lib/server/services/notifications";

export const metadata: Metadata = { title: "Notifications" };

const dateTime = new Intl.DateTimeFormat("en-LK", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Colombo",
});

async function Notifications() {
  const user = await requireUser("/account/notifications");
  const { items, unread } = await myNotifications(user);
  if (!items.length)
    return (
      <EmptyState
        title="No notifications"
        text="Order updates, answers to your questions and decisions about your shop appear here."
      />
    );
  return (
    <>
      {unread ? (
        <div className="mb-5">
          <MarkAllReadButton />
        </div>
      ) : null}
      <ul className="divide-y divide-line rounded-lg border border-line bg-paper-raised">
        {items.map((n) => (
          <li key={n.id}>
            <Link href={n.href || "/account"} className="flex flex-col gap-0.5 px-5 py-4 hover:bg-sage">
              <span className={n.readAt ? "" : "font-semibold"}>
                {n.readAt ? null : <span className="sr-only">Unread: </span>}
                {n.title}
              </span>
              <span className="text-sm text-ink-soft">{dateTime.format(new Date(n.createdAt))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function NotificationsPage() {
  return (
    <>
      <PageTitle title="Notifications" />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Notifications />
      </Suspense>
    </>
  );
}
