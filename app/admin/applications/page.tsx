import Link from "next/link";
import { db } from "@/lib/server/db/tx";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, FilterLinks, Td } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { listApplications, listUsers } from "@/lib/server/repositories/people";

export const metadata = { title: "Applications" };

const FILTERS = ["PENDING", "NEEDS_CHANGES", "APPROVED", "REJECTED", "ALL"] as const;

async function Applications({ searchParams }: { searchParams: PageProps<"/admin/applications">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/applications");
  const { status } = await searchParams;
  const current = FILTERS.find((f) => f === status) ?? "PENDING";
  const list = (await listApplications(db)).filter((a) => current === "ALL" || a.status === current);
  const userNames = new Map((await listUsers(db)).map((u) => [u.id, u.name]));
  return (
    <>
      <FilterLinks
        current={current}
        items={FILTERS.map((f) => ({
          value: f,
          label:
            f === "ALL" ? "All" : f === "NEEDS_CHANGES" ? "Changes requested" : f.charAt(0) + f.slice(1).toLowerCase(),
          href: `/admin/applications?status=${f}`,
        }))}
      />
      {list.length ? (
        <DataTable
          caption="Shop applications"
          headers={["Shop", "Applicant", "Craft", "District", "Submitted", "Status"]}
        >
          {list.map((a) => (
            <tr key={a.id}>
              <Td>
                <Link
                  href={`/admin/applications/${a.id}`}
                  className="font-semibold text-forest underline underline-offset-4"
                >
                  {a.shopName}
                </Link>
              </Td>
              <Td>{userNames.get(a.userId) ?? "Unknown"}</Td>
              <Td className="max-w-[220px]">{a.craft}</Td>
              <Td>{a.address.district}</Td>
              <Td>{formatDate(a.createdAt)}</Td>
              <Td>
                <StatusBadge status={a.status} />
              </Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState title="Nothing here" text="No applications match this filter." />
      )}
    </>
  );
}

export default function AdminApplicationsPage(props: PageProps<"/admin/applications">) {
  return (
    <>
      <PageTitle title="Shop applications" description="Approve makers, reject with a reason, or ask for changes." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Applications searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
