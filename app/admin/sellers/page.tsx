import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, FilterLinks, Td } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/lib/server/auth";
import { shopRatings } from "@/lib/server/catalogue";
import { listShops } from "@/lib/server/repositories/catalogue";
import { itemCountsByShop } from "@/lib/server/repositories/catalogue-search";
import { openReportCounts } from "@/lib/server/repositories/content";
import { userNamesByIds } from "@/lib/server/repositories/people";
import { db } from "@/lib/server/db/tx";

export const metadata = { title: "Sellers" };

const FILTERS = ["ALL", "ACTIVE", "DRAFT", "SUSPENDED", "CLOSED"] as const;

async function Sellers({ searchParams }: { searchParams: PageProps<"/admin/sellers">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/sellers");
  const { status } = await searchParams;
  const current = FILTERS.find((f) => f === status) ?? "ALL";
  const shops = (await listShops(db)).filter((s) => current === "ALL" || s.status === current);
  // B13: four grouped queries for the whole table, not four per shop.
  const ids = shops.map((s) => s.id);
  const [ratings, owners, reportCounts, itemCounts] = await Promise.all([
    shopRatings(ids),
    userNamesByIds(db, [...new Set(shops.map((s) => s.ownerId))]),
    openReportCounts(db, "SHOP", ids),
    itemCountsByShop(db, ids, ["DRAFT", "PENDING_REVIEW", "ACTIVE", "REJECTED", "ARCHIVED"]),
  ]);
  const rows = shops.map((s) => ({
    s,
    rating: ratings.get(s.id),
    ownerName: owners.get(s.ownerId) ?? "Unknown",
    reports: reportCounts.get(s.id) ?? 0,
    itemCount: itemCounts.get(s.id) ?? 0,
  }));
  return (
    <>
      <FilterLinks
        current={current}
        items={FILTERS.map((f) => ({
          value: f,
          label: f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase(),
          href: `/admin/sellers?status=${f}`,
        }))}
      />
      {shops.length ? (
        <DataTable caption="Shops" headers={["Shop", "Owner", "Status", "Items", "Rating", "Open reports"]}>
          {rows.map(({ s, rating, ownerName, reports, itemCount }) => (
            <tr key={s.id}>
              <Td>
                <Link
                  href={`/admin/sellers/${s.id}`}
                  className="font-semibold text-forest underline underline-offset-4"
                >
                  {s.name}
                </Link>
                {s.isVerified ? <span className="ml-2 text-sm text-forest">Verified</span> : null}
              </Td>
              <Td>{ownerName}</Td>
              <Td>
                <StatusBadge status={s.status} />
              </Td>
              <Td className="tabular-nums">{itemCount}</Td>
              <Td className="tabular-nums">{rating ? `${rating.average.toFixed(1)} (${rating.count})` : "None"}</Td>
              <Td className="tabular-nums">{reports}</Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState title="No shops" text="No shops match this filter." />
      )}
    </>
  );
}

export default function AdminSellersPage(props: PageProps<"/admin/sellers">) {
  return (
    <>
      <PageTitle title="Sellers" description="Suspend, reinstate, verify or close shops. Every change is audited." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Sellers searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
