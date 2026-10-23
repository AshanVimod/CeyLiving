import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { GeneratePayoutsButton, MarkPaidButton } from "@/components/admin/payout-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { PAYOUT_HOLD_DAYS } from "@/lib/config";
import { formatDate, formatLkr } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db/tx";
import { listShops } from "@/lib/server/repositories/catalogue";
import { listPayouts } from "@/lib/server/repositories/commerce";

export const metadata = { title: "Payouts" };

async function Payouts() {
  await requireRole(["ADMIN"], "/admin/payouts");
  const shops = await listShops(db);
  const payouts = [...(await listPayouts(db))].sort(
    (a, b) => Number(a.status === "PAID") - Number(b.status === "PAID") || b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <>
      <div className="mb-8 rounded-lg border border-line bg-paper-raised p-5">
        <p className="mb-4 text-ink-soft">
          Collects every order delivered more than {PAYOUT_HOLD_DAYS} days ago that hasn’t been paid out, one statement
          per shop. Shops without payout details are skipped until they add them.
        </p>
        <GeneratePayoutsButton />
      </div>
      {payouts.length ? (
        <DataTable
          caption="Payout statements"
          headers={["Shop", "Period", "Orders", "Commission", "Pay out", "Status", ""]}
        >
          {payouts.map((p) => {
            const shop = shops.find((s) => s.id === p.shopId);
            return (
              <tr key={p.id}>
                <Td>
                  <span className="font-semibold">{shop?.name}</span>
                  <span className="block text-sm text-ink-soft">{shop?.payoutAccountMasked}</span>
                </Td>
                <Td>
                  {formatDate(p.periodStart)} to {formatDate(p.periodEnd)}
                </Td>
                <Td className="tabular-nums">{p.sellerOrderIds.length}</Td>
                <Td className="tabular-nums">{formatLkr(p.commissionCents)}</Td>
                <Td className="font-semibold tabular-nums">{formatLkr(p.netCents)}</Td>
                <Td>
                  <StatusBadge
                    status={p.status}
                    label={p.status === "SCHEDULED" ? "Scheduled" : p.status === "PAID" ? "Paid" : undefined}
                  />
                  {p.reference ? <span className="mt-1 block text-xs text-ink-soft">Ref {p.reference}</span> : null}
                </Td>
                <Td>
                  {p.status === "SCHEDULED" && shop ? <MarkPaidButton payoutId={p.id} shopName={shop.name} /> : null}
                </Td>
              </tr>
            );
          })}
        </DataTable>
      ) : (
        <EmptyState title="No statements yet" text="Create this week’s statements to see what each shop is owed." />
      )}
    </>
  );
}

export default function AdminPayoutsPage() {
  return (
    <>
      <PageTitle
        title="Payouts"
        description="Weekly statements per shop (spec BR-10 and BR-11). Mark each one paid once the bank transfer is done."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Payouts />
      </Suspense>
    </>
  );
}
