import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { FilterLinks } from "@/components/admin/data-table";
import { ModerationActions } from "@/components/admin/moderation-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { moderationQueue } from "@/lib/server/moderation-queue";

export const metadata = { title: "Moderation" };

const TYPES = ["ALL", "REVIEW", "QUESTION", "ANSWER"] as const;
const VIEWS = ["all", "reported", "hidden", "deleted"] as const;

async function Queue({ searchParams }: { searchParams: PageProps<"/admin/moderation">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/moderation");
  const sp = await searchParams;
  const type = TYPES.find((t) => t === sp.type) ?? "ALL";
  const view = VIEWS.find((v) => v === sp.filter) ?? "all";
  const items = await moderationQueue({ type, view });
  const href = (t: string, v: string) => `/admin/moderation?type=${t}&filter=${v}`;
  return (
    <>
      <FilterLinks
        label="Post type"
        current={type}
        items={TYPES.map((t) => ({
          value: t,
          label: t === "ALL" ? "All posts" : `${t.charAt(0)}${t.slice(1).toLowerCase()}s`,
          href: href(t, view),
        }))}
      />
      <FilterLinks
        label="Status"
        current={view}
        items={VIEWS.map((v) => ({
          value: v,
          label: v === "all" ? "Not deleted" : v.charAt(0).toUpperCase() + v.slice(1),
          href: href(type, v),
        }))}
      />
      {items.length ? (
        <ul className="space-y-4">
          {items.map((i) => (
            <li key={`${i.type}-${i.id}`} className="rounded-lg border border-line bg-paper-raised p-5">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <StatusBadge status={i.status} />
                {i.openReports ? (
                  <span className="font-semibold text-lacquer">
                    {i.openReports} open {i.openReports === 1 ? "report" : "reports"}
                  </span>
                ) : null}
                <span className="text-ink-soft">
                  {i.context.href ? (
                    <Link href={i.context.href} className="underline underline-offset-4">
                      {i.context.title}
                    </Link>
                  ) : (
                    i.context.title
                  )}
                </span>
              </div>
              <p className="mt-3 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{i.text || "(erased)"}</p>
              <p className="mt-2 text-sm text-ink-soft">
                By{" "}
                <Link href={`/admin/users/${i.authorId}`} className="underline underline-offset-4">
                  {i.authorName}
                </Link>
                , {formatDate(i.createdAt)}
              </p>
              {i.statusReason ? <p className="mt-1 text-sm text-ink-soft">Reason: {i.statusReason}</p> : null}
              <div className="mt-4">
                <ModerationActions targetType={i.type} targetId={i.id} status={i.status} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing to review" text="No posts match these filters." />
      )}
    </>
  );
}

export default function ModerationPage(props: PageProps<"/admin/moderation">) {
  return (
    <>
      <PageTitle
        title="Moderation"
        description="Reviews, questions and answers. Most-reported first. You can hide, restore, delete or reply, but never edit what someone wrote."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Queue searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
