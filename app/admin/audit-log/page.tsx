import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, FilterLinks, Td } from "@/components/admin/data-table";
import { requireRole } from "@/lib/server/auth";
import { findUserById, listAuditLog } from "@/lib/server/repositories/people";

export const metadata = { title: "Audit log" };

const TYPES = ["ALL", "APPLICATION", "SHOP", "PRODUCT", "REVIEW", "QUESTION", "ANSWER", "USER", "REPORT"] as const;

const dateTime = new Intl.DateTimeFormat("en-LK", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Colombo",
});

/** FR-10: read-only, append-only record of every admin action (SEC-11). */
async function AuditLog({ searchParams }: { searchParams: PageProps<"/admin/audit-log">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/audit-log");
  const { type } = await searchParams;
  const current = TYPES.find((t) => t === type) ?? "ALL";
  const entries = listAuditLog().filter((e) => current === "ALL" || e.targetType === current);
  return (
    <>
      <FilterLinks
        current={current}
        items={TYPES.map((t) => ({
          value: t,
          label: t === "ALL" ? "All" : t.charAt(0) + t.slice(1).toLowerCase(),
          href: `/admin/audit-log?type=${t}`,
        }))}
      />
      {entries.length ? (
        <DataTable caption="Audit log" headers={["When", "Who", "Action", "Target", "Reason"]}>
          {entries.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap">{dateTime.format(new Date(e.createdAt))}</Td>
              <Td>{findUserById(e.actorId)?.name ?? e.actorId}</Td>
              <Td className="font-semibold">{e.action}</Td>
              <Td className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                {e.targetType} {e.targetId}
              </Td>
              <Td className="max-w-[260px] text-ink-soft">{e.reason ?? "None"}</Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState title="No entries yet" text="Admin actions will appear here as they happen." />
      )}
    </>
  );
}

export default function AuditLogPage(props: PageProps<"/admin/audit-log">) {
  return (
    <>
      <PageTitle
        title="Audit log"
        description="Every approval, rejection, suspension, hide, delete and ban. Entries can’t be edited or removed."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <AuditLog searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
