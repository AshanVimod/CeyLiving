import Link from "next/link";
import { formatDate, formatTime } from "@/lib/format";
import type { OperationsOverview } from "@/lib/server/services/ops";

// B12 (OPS-07): the state of the background work and the security events, read-only, for admins only. Counts,
// names of jobs and times; never a person, an address or an IP.

const WORKER_SILENT_MS = 5 * 60_000;

function when(date: Date) {
  return `${formatDate(date.toISOString())}, ${formatTime(date.toISOString())}`;
}

function ago(date: Date, now: number) {
  const minutes = Math.max(0, Math.round((now - date.getTime()) / 60_000));
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return when(date);
}

function Row({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[11rem_1fr]">
      <dt className="font-medium">{label}</dt>
      <dd className={warn ? "text-lacquer" : "text-ink-soft"}>{children}</dd>
    </div>
  );
}

export function OperationsCard({ ops, now }: { ops: OperationsOverview; now: number }) {
  const workerDown = !ops.workerLastSeen || now - ops.workerLastSeen.getTime() > WORKER_SILENT_MS;
  const queues = [
    ops.queues.waiting && `${ops.queues.waiting} waiting`,
    ops.queues.retrying && `${ops.queues.retrying} retrying`,
    ops.queues.running && `${ops.queues.running} running`,
  ].filter(Boolean);
  const e = ops.last24h;
  return (
    <section aria-labelledby="operations" className="mt-10 rounded-lg border border-line bg-paper-raised p-5">
      <h2 id="operations" className="font-display text-2xl">
        Operations
      </h2>
      <dl className="mt-3">
        <Row label="Worker" warn={workerDown}>
          {workerDown
            ? ops.workerLastSeen
              ? `Not running. Last seen ${ago(ops.workerLastSeen, now)}.`
              : "Not running. It has never run against this database."
            : `Running, last seen ${ago(ops.workerLastSeen!, now)}.`}
        </Row>
        <Row label="Failed jobs" warn={ops.failedJobs.total > 0}>
          {ops.failedJobs.total === 0
            ? "None in the last 7 days."
            : `${ops.failedJobs.total} in the last 7 days: ${ops.failedJobs.byName.map((j) => `${j.name} ${j.count}`).join(" · ")}`}
        </Row>
        <Row label="Queues">{queues.length ? queues.join(" · ") : "Nothing waiting."}</Row>
        <Row label="Last payout run">{ops.lastPayoutRun ? when(ops.lastPayoutRun) : "Not run yet."}</Row>
        <Row label="Last backup" warn={ops.backup.state === "failed"}>
          {ops.backup.state === "not_set_up"
            ? "Not set up yet."
            : ops.backup.state === "failed"
              ? `Failed ${when(ops.backup.at)}.`
              : `Succeeded ${when(ops.backup.at)}.`}
        </Row>
        <Row label="Emails" warn={ops.emails.failed > 0}>
          {ops.emails.queued} queued · {ops.emails.failed} failed in 7 days.{" "}
          <Link href="/admin/emails" className="underline">
            See emails
          </Link>
        </Row>
        <Row label="Last 24 hours">
          Failed sign-ins {e.sign_in_failed} · Sign-in limits reached {e.auth_rate_limited} · Payment signature failures{" "}
          {e.payment_signature_failed} · Actions refused {e.permission_denied} · Bank details shown {e.payout_revealed}{" "}
          (failed {e.payout_reveal_failed}, locked {e.payout_reveal_locked}) · Server errors {e.server_error} · Jobs
          failed {e.job_failed} · Requests refused {e.origin_rejected + e.body_too_large}
        </Row>
        <Row label="Alerts" warn={ops.emails.failedAlerts > 0}>
          {ops.lastAlert ? `Last sent ${when(ops.lastAlert.at)}: ${ops.lastAlert.label}.` : "None sent yet."}
          {ops.emails.failedAlerts > 0 &&
            ` ${ops.emails.failedAlerts} alert email${ops.emails.failedAlerts === 1 ? "" : "s"} failed in 7 days.`}
        </Row>
      </dl>
    </section>
  );
}
