import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { RefundButton, ReleaseHoldButton, ResolveRefundButton } from "@/components/admin/payment-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatLkr } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { adminPaymentsOverview } from "@/lib/server/services/payments";

export const metadata = { title: "Payments" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-2xl">{title}</h2>
      {children}
    </section>
  );
}

async function Payments() {
  const actor = await requireRole(["ADMIN"], "/admin/payments");
  const data = await adminPaymentsOverview(actor);
  const payHere = data.canRefundThroughPayHere;
  const differences =
    (data.lastReconciliation?.after as { checked?: number; differences?: { kind: string; orderNumber: string }[] }) ??
    undefined;
  return (
    <>
      <Section title="Needs a refund">
        {data.cancelledToRefund.length || data.latePayments.length ? (
          <DataTable caption="Money to give back" headers={["Order", "Why", "Amount", "Payment", ""]}>
            {data.cancelledToRefund.map((so) => (
              <tr key={so.id}>
                <Td>
                  <span className="font-semibold">{so.orderNumber}</span>
                  <span className="block text-sm text-ink-soft">{so.shopName}</span>
                </Td>
                <Td>Cancelled: {so.cancelReason ?? "no reason recorded"}</Td>
                <Td className="tabular-nums">{formatLkr(so.subtotalCents + so.shippingCents)}</Td>
                <Td className="text-sm text-ink-soft">Order payment</Td>
                <Td>
                  <RefundButton
                    target={{ sellerOrderId: so.id }}
                    title={`Refund ${so.orderNumber} (${so.shopName})`}
                    amount={formatLkr(so.subtotalCents + so.shippingCents)}
                    payHereAvailable={payHere}
                  />
                </Td>
              </tr>
            ))}
            {data.latePayments.map((p) => (
              <tr key={p.id}>
                <Td className="font-semibold">{p.orderNumber}</Td>
                <Td>{p.needsRefundReason}</Td>
                <Td className="tabular-nums">{formatLkr(p.amountCents)}</Td>
                <Td className="text-sm text-ink-soft">PayHere {p.providerPaymentId}</Td>
                <Td>
                  <RefundButton
                    target={{ paymentId: p.id }}
                    title={`Refund the payment for ${p.orderNumber}`}
                    amount={formatLkr(p.amountCents)}
                    payHereAvailable={payHere}
                  />
                </Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState title="Nothing to refund" text="Cancelled paid orders and late payments appear here." />
        )}
      </Section>

      <Section title="Refunds">
        {data.refunds.length ? (
          <DataTable caption="Recent refunds" headers={["Order", "Amount", "Reason", "How", "Status", ""]}>
            {data.refunds.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-semibold">{r.orderNumber}</span>
                  <span className="block text-sm text-ink-soft">
                    {r.shopName ?? "Whole payment"} · PayHere {r.providerPaymentId}
                  </span>
                </Td>
                <Td className="tabular-nums">
                  {formatLkr(r.amountCents)}
                  {r.clawbackCents ? (
                    <span className="block text-xs text-ink-soft">
                      {formatLkr(r.clawbackCents)} from the shop’s {r.deductedPayoutId ? "payout" : "next payout"}
                    </span>
                  ) : null}
                </Td>
                <Td>{r.reason}</Td>
                <Td className="text-sm">
                  {r.method === "PAYHERE" ? "PayHere" : "Bank"}
                  {r.providerRef ? <span className="block text-xs text-ink-soft">Ref {r.providerRef}</span> : null}
                </Td>
                <Td>
                  <StatusBadge
                    status={r.status}
                    label={r.status === "SUCCEEDED" ? "Refunded" : r.status === "PENDING" ? "Pending" : "Failed"}
                  />
                  {r.failure ? <span className="mt-1 block text-xs text-lacquer">{r.failure}</span> : null}
                  <span className="mt-1 block text-xs text-ink-soft">{formatDate(r.createdAt)}</span>
                </Td>
                <Td>
                  {r.status === "PENDING" && r.method === "PAYHERE" ? <ResolveRefundButton refundId={r.id} /> : null}
                </Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState title="No refunds yet" text="Refunds you issue are listed here with their reference." />
        )}
      </Section>

      <Section title="Delivered orders (disputes)">
        {data.delivered.length ? (
          <DataTable caption="Dispatched or delivered paid orders" headers={["Order", "Status", "Amount", ""]}>
            {data.delivered.map((so) => (
              <tr key={so.id}>
                <Td>
                  <span className="font-semibold">{so.orderNumber}</span>
                  <span className="block text-sm text-ink-soft">{so.shopName}</span>
                </Td>
                <Td>
                  <StatusBadge status={so.status} />
                </Td>
                <Td className="tabular-nums">{formatLkr(so.subtotalCents + so.shippingCents)}</Td>
                <Td>
                  <RefundButton
                    target={{ sellerOrderId: so.id }}
                    title={`Refund ${so.orderNumber} (${so.shopName})`}
                    amount={formatLkr(so.subtotalCents + so.shippingCents)}
                    payHereAvailable={payHere}
                  />
                </Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState title="None" text="Paid orders on their way or delivered appear here." />
        )}
      </Section>

      <Section title="Chargebacks and held payouts">
        {data.held.length ? (
          <DataTable caption="Shops with payouts on hold" headers={["Shop", "Why", "Since", ""]}>
            {data.held.map((s) => (
              <tr key={s.id}>
                <Td className="font-semibold">{s.name}</Td>
                <Td>{s.reason}</Td>
                <Td>{formatDate(s.heldAt)}</Td>
                <Td>
                  <ReleaseHoldButton shopId={s.id} shopName={s.name} />
                </Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState title="No payouts on hold" text="A chargeback holds the shop’s payouts until you release them." />
        )}
        {data.chargebacks.length ? (
          <ul className="mt-4 space-y-1 text-sm text-ink-soft">
            {data.chargebacks.map((p) => (
              <li key={p.id}>
                {p.orderNumber}: {formatLkr(p.amountCents)} charged back (PayHere {p.providerPaymentId}),{" "}
                {formatDate(p.updatedAt)}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Daily check with PayHere">
        {data.lastReconciliation && differences ? (
          <div className="rounded-lg border border-line bg-paper-raised p-5">
            <p>
              {data.lastReconciliation.targetId}: {differences.checked ?? 0} orders checked,{" "}
              {differences.differences?.length ?? 0} difference(s).
            </p>
            {differences.differences?.length ? (
              <ul className="mt-3 list-disc pl-5 text-sm">
                {differences.differences.map((d, i) => (
                  <li key={i}>
                    {d.orderNumber}: {d.kind.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-sm text-ink-soft">The check only reports; nothing is changed automatically.</p>
          </div>
        ) : (
          <EmptyState
            title="No check yet"
            text="Runs daily at 02:00 once the PayHere Merchant API key (PAYHERE_APP_ID) is set."
          />
        )}
      </Section>
    </>
  );
}

export default function AdminPaymentsPage() {
  return (
    <>
      <PageTitle
        title="Payments"
        description="Refunds (BR-18), late payments (PAY-06), chargebacks (PAY-05) and the daily check with PayHere (PAY-08)."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Payments />
      </Suspense>
    </>
  );
}
