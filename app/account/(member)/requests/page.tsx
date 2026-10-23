import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { QuoteResponse } from "@/components/requests/request-forms";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatLkr } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { effectiveStatus, requestsOfCustomer } from "@/lib/server/services/custom-requests";
import { readStore } from "@/lib/server/store/dev-store";

export const metadata: Metadata = { title: "Custom requests" };

const LABEL = {
  OPEN: "Waiting for the maker",
  QUOTED: "Quote received",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
} as const;

async function Requests() {
  const user = await requireUser("/account/requests");
  const db = readStore();
  const requests = requestsOfCustomer(user, db);
  if (!requests.length) {
    return (
      <EmptyState
        title="No requests yet"
        text="Ask a maker for something made just for you."
        action={
          <Link
            href="/custom"
            className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep"
          >
            Send a request
          </Link>
        }
      />
    );
  }
  return (
    <ul className="space-y-4">
      {requests.map((r) => {
        const status = effectiveStatus(r);
        const shop = db.shops.find((s) => s.id === r.shopId);
        return (
          <li key={r.id} className="rounded-lg border border-line bg-paper-raised p-5">
            <p className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{shop?.name}</span>
              <StatusBadge
                status={
                  status === "QUOTED"
                    ? "PENDING"
                    : status === "ACCEPTED"
                      ? "APPROVED"
                      : status === "OPEN"
                        ? "NEW"
                        : "CANCELLED"
                }
                label={LABEL[status]}
              />
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              Sent {formatDate(r.createdAt)}
              {r.budgetCents ? `, budget ${formatLkr(r.budgetCents)}` : ""}
            </p>
            <p className="mt-3 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{r.message}</p>
            {r.quote ? (
              <div className="mt-4 rounded-md bg-sage p-4">
                <p className="font-semibold">
                  Quote: {formatLkr(r.quote.priceCents)}, ready in about {r.quote.days} days
                </p>
                {r.quote.message ? (
                  <p className="mt-1 text-ink-soft [overflow-wrap:anywhere]">{r.quote.message}</p>
                ) : null}
                {status === "QUOTED" ? (
                  <div className="mt-4">
                    <QuoteResponse requestId={r.id} />
                  </div>
                ) : null}
                {status === "ACCEPTED" ? (
                  <p className="mt-2 text-sm text-ink-soft">
                    The maker will list this as a made-to-order item for you to buy.
                  </p>
                ) : null}
              </div>
            ) : null}
            {r.declineReason ? <p className="mt-3 text-ink-soft">The maker said: {r.declineReason}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function RequestsPage() {
  return (
    <>
      <PageTitle title="Custom requests" description="Requests expire after 14 days without a reply." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Requests />
      </Suspense>
    </>
  );
}
