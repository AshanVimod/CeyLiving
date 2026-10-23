import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DeclineRequestButton, QuoteForm } from "@/components/requests/request-forms";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatLkr } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { effectiveStatus, requestsOfSeller } from "@/lib/server/services/custom-requests";

export const metadata = { title: "Custom requests" };

const LABEL = { OPEN: "New", QUOTED: "Quote sent", ACCEPTED: "Accepted", DECLINED: "Declined", EXPIRED: "Expired" } as const;
const ORDER = { OPEN: 0, QUOTED: 1, ACCEPTED: 2, DECLINED: 3, EXPIRED: 4 } as const;

async function Requests() {
  const user = await requireRole(["SELLER"], "/seller/requests");
  const requests = requestsOfSeller(user)
    .map((r) => ({ r, status: effectiveStatus(r) }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  if (!requests.length) return <EmptyState title="No requests yet" text="When customers ask you for something made to order, it appears here." />;
  return (
    <ul className="space-y-4">
      {requests.map(({ r, status }) => (
        <li key={r.id} className="rounded-lg border border-line bg-paper-raised p-5">
          <p className="flex flex-wrap items-center gap-3">
            <span className="font-semibold">{r.customerName}</span>
            <StatusBadge status={status === "OPEN" ? "NEW" : status === "ACCEPTED" ? "APPROVED" : status === "QUOTED" ? "PENDING" : "CANCELLED"} label={LABEL[status]} />
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {formatDate(r.createdAt)}
            {r.budgetCents ? `, budget ${formatLkr(r.budgetCents)}` : ", no budget given"}
          </p>
          <p className="mt-3 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{r.message}</p>
          {r.quote ? (
            <p className="mt-3 rounded-md bg-sage px-4 py-3">
              Your quote: {formatLkr(r.quote.priceCents)}, {r.quote.days} days{status === "ACCEPTED" ? ". Accepted: list it as a made-to-order item for them to buy." : "."}
            </p>
          ) : null}
          {status === "OPEN" ? (
            <div className="mt-4 space-y-4 border-t border-line pt-4">
              <QuoteForm requestId={r.id} />
              <DeclineRequestButton requestId={r.id} />
            </div>
          ) : null}
          {status === "QUOTED" ? (
            <div className="mt-4">
              <DeclineRequestButton requestId={r.id} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function SellerRequestsPage() {
  return (
    <>
      <PageTitle title="Custom requests" description="Quote a price and time, or decline politely. Customers’ contact details stay private." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Requests />
      </Suspense>
    </>
  );
}
