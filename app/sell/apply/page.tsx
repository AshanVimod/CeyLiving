import type { Metadata } from "next";
import { db } from "@/lib/server/db/tx";
import Link from "next/link";
import { Suspense } from "react";
import { ApplicationForm } from "@/components/seller/application-form";
import { Container } from "@/components/ui/section-heading";
import { StatusBadge } from "@/components/ui/status-badge";
import { REAPPLY_WAIT_DAYS } from "@/lib/config";
import { daysSince, formatDate } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { applicationsOf } from "@/lib/server/repositories/people";

export const metadata: Metadata = { title: "Apply to sell", robots: { index: false } };

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised p-6">
      <h2 className="text-2xl">{title}</h2>
      <div className="mt-3 text-ink-soft">{children}</div>
    </div>
  );
}

async function Apply() {
  const user = await requireUser("/sell/apply");
  if (user.role !== "CUSTOMER") {
    return (
      <Notice title={user.role === "SELLER" ? "You already have a shop" : "Admins can’t apply"}>
        {user.role === "SELLER" ? (
          <Link href="/seller" className="font-semibold text-forest underline underline-offset-4">
            Go to your seller dashboard
          </Link>
        ) : (
          "Use a customer account to apply."
        )}
      </Notice>
    );
  }
  const latest = (await applicationsOf(db, user.id))[0];
  if (latest?.status === "PENDING") {
    return (
      <Notice title="Your application is being reviewed">
        <p className="flex flex-wrap items-center gap-3">
          {latest.shopName} <StatusBadge status={latest.status} />
        </p>
        <p className="mt-2">Submitted {formatDate(latest.createdAt)}. We usually reply within five working days.</p>
      </Notice>
    );
  }
  const rejectedRecently =
    latest?.status === "REJECTED" && latest.decidedAt && daysSince(latest.decidedAt) < REAPPLY_WAIT_DAYS;
  if (rejectedRecently) {
    return (
      <Notice title="You can apply again soon">
        <p>Your last application was not approved. You can apply again {REAPPLY_WAIT_DAYS} days after the decision.</p>
        {latest.adminNote ? <p className="mt-2">Reason: {latest.adminNote}</p> : null}
      </Notice>
    );
  }
  const editing = latest?.status === "NEEDS_CHANGES" ? latest : undefined;
  return (
    <>
      {editing?.adminNote ? (
        <p role="status" className="mb-6 rounded-md bg-turmeric-soft px-4 py-3">
          <span className="font-semibold">Changes requested: </span>
          {editing.adminNote}
        </p>
      ) : null}
      <ApplicationForm existing={editing} defaultPhone={user.phone} />
    </>
  );
}

export default function ApplyPage() {
  return (
    <Container className="max-w-3xl pt-10">
      <h1 className="text-[2.4rem] sm:text-[3rem]">Apply to sell</h1>
      <p className="mt-3 mb-8 text-lg text-ink-soft">
        Tell us about your work. We review every application, usually within five working days. Approved makers set up
        their shop and start listing straight away.
      </p>
      <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
        <Apply />
      </Suspense>
    </Container>
  );
}
