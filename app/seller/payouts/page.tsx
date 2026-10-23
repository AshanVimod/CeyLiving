import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { PAYOUT_HOLD_DAYS } from "@/lib/config";
import { formatDate, formatLkr } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { sellerPayoutSummary } from "@/lib/server/services/payouts";

export const metadata = { title: "Payouts" };

async function Payouts() {
  const user = await requireRole(["SELLER"], "/seller/payouts");
  const { shop, payouts, onHold, ready, rateBps } = await sellerPayoutSummary(user);
  const pending = [...ready, ...onHold];
  return (
    <>
      <section aria-labelledby="account-h" className="mb-8 rounded-lg border border-line bg-paper-raised p-5">
        <h2 id="account-h" className="font-sans text-base font-semibold">
          Payout account
        </h2>
        <p className="mt-1 text-ink-soft">
          {shop.payoutAccountMasked ?? "Not added yet. Payouts wait until you add one."}{" "}
          <Link href="/seller/shop#payout" className="font-semibold text-forest underline underline-offset-4">
            {shop.payoutAccountMasked ? "Change" : "Add payout details"}
          </Link>
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          CeyLiving keeps {rateBps / 100}% of the item price. Delivery fees are passed to you in full. Earnings become
          payable {PAYOUT_HOLD_DAYS} days after the customer receives the order and are paid weekly.
        </p>
      </section>

      <h2 className="mb-4 text-2xl">Not paid out yet</h2>
      {pending.length ? (
        <DataTable
          caption="Earnings not yet paid out"
          headers={["Order", "Delivered", "Payable from", "Your earnings"]}
        >
          {pending.map((u) => (
            <tr key={u.sellerOrder.id}>
              <Td>
                <Link href={`/seller/orders/${u.sellerOrder.id}`} className="text-forest underline underline-offset-4">
                  {u.sellerOrder.id.replace("so_", "#")}
                </Link>
              </Td>
              <Td>{formatDate(u.sellerOrder.completedAt!)}</Td>
              <Td>{formatDate(u.payableFrom.toISOString())}</Td>
              <Td className="tabular-nums">{formatLkr(u.netCents)}</Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <p className="text-ink-soft">Nothing waiting. Delivered orders appear here.</p>
      )}

      <h2 className="mt-10 mb-4 text-2xl">Statements</h2>
      {payouts.length ? (
        <DataTable
          caption="Payout statements"
          headers={["Period", "Orders", "Sales and delivery", "Commission", "You receive", "Status"]}
        >
          {payouts.map((p) => (
            <tr key={p.id}>
              <Td>
                {formatDate(p.periodStart)} to {formatDate(p.periodEnd)}
              </Td>
              <Td className="tabular-nums">{p.sellerOrderIds.length}</Td>
              <Td className="tabular-nums">{formatLkr(p.grossCents)}</Td>
              <Td className="tabular-nums">−{formatLkr(p.commissionCents)}</Td>
              <Td className="font-semibold tabular-nums">{formatLkr(p.netCents)}</Td>
              <Td>
                <StatusBadge
                  status={p.status}
                  label={
                    p.status === "PAID"
                      ? `Paid ${p.paidAt ? formatDate(p.paidAt) : ""}`
                      : p.status === "SCHEDULED"
                        ? "Scheduled"
                        : undefined
                  }
                />
                {p.reference ? <span className="mt-1 block text-xs text-ink-soft">Ref {p.reference}</span> : null}
              </Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <p className="text-ink-soft">
          No statements yet. The first one is created after your first delivered order passes the {PAYOUT_HOLD_DAYS}-day
          hold.
        </p>
      )}
    </>
  );
}

export default function SellerPayoutsPage() {
  return (
    <>
      <PageTitle title="Payouts" description="Weekly statements with the commission taken from each order." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Payouts />
      </Suspense>
    </>
  );
}
