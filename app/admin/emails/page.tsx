import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { RetryEmailButton } from "@/components/admin/email-actions";
import { WorkerStatus } from "@/components/admin/worker-status";
import { formatDate, formatTime } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { emailOverview } from "@/lib/server/services/email-admin";

export const metadata = { title: "Emails" };

const STATE_LABEL = { failed: "Failed", retrying: "Retrying", stuck: "Stuck" } as const;

async function Emails() {
  const actor = await requireRole(["ADMIN"], "/admin/emails");
  const now = new Date();
  const { items, health } = await emailOverview(actor, now);
  return (
    <>
      <WorkerStatus health={health} now={now.getTime()} />
      {items.length ? (
        <DataTable caption="Emails that failed or are stuck" headers={["Email", "Queued", "Tries", "State", "Why", ""]}>
          {items.map((item) => (
            <tr key={item.id}>
              <Td>
                <span className="font-semibold">{item.label}</span>
                <Link href={`/admin/users/${item.userId}`} className="block text-sm text-ink-soft underline">
                  The recipient’s account
                </Link>
              </Td>
              <Td className="text-sm">
                {formatDate(item.createdAt)}, {formatTime(item.createdAt)}
              </Td>
              <Td className="tabular-nums">{item.attempts}</Td>
              <Td>{STATE_LABEL[item.state]}</Td>
              <Td className="text-sm">{item.reason}</Td>
              <Td>
                {item.retry.allowed ? (
                  <RetryEmailButton deliveryId={item.id} label={item.label} />
                ) : (
                  <span className="text-sm text-ink-soft">{item.retry.why}</span>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState
          title="No email problems"
          text="Failed emails, and emails waiting more than 30 minutes, appear here for 30 days."
        />
      )}
    </>
  );
}

export default function AdminEmailsPage() {
  return (
    <>
      <PageTitle
        title="Emails"
        description="Emails that failed or are stuck. Addresses and email content are never shown here."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Emails />
      </Suspense>
    </>
  );
}
