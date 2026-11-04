import "server-only";
import { db, withTx } from "../db/tx";
import { EMAIL_LABELS, SIGN_IN_EMAILS, type EmailTemplate } from "../email/catalogue";
import { ConflictError, NotFoundError } from "../errors";
import { assertRole, type Actor } from "../permissions";
import { clearEmailAlert, countWaitingEmails, emailProblems, findEmailDelivery } from "../repositories/email";
import { deliveriesWithPendingJobs, enqueue, workerLastSeen } from "../repositories/jobs";
import { audit } from "./shared";

// B10: what admins see when emails go wrong (/admin/emails, the dashboard tile), the worker health check
// (/api/health/worker), and sending a stuck email again. No address or email content ever leaves this file (OPS-01).

const MINUTE = 60_000;

/** An email still QUEUED this long after it was asked for is stuck: every retry has run its course (JOB-04). */
export const EMAIL_STUCK_AFTER_MINUTES = 30;
/** Sign-in links (verify, reset) expire after an hour, so sending one later is pointless. */
export const SIGN_IN_LINK_MINUTES = 60;
/** The worker counts as stopped when pg-boss hasn't seen it for this long (it checks in about every 30 seconds). */
export const WORKER_SILENT_AFTER_MINUTES = 5;

export interface WorkerHealth {
  ok: boolean;
  /** When pg-boss last saw a worker; undefined if never. */
  lastSeen?: Date;
  workerSilent: boolean;
  /** Emails waiting longer than EMAIL_STUCK_AFTER_MINUTES. */
  stuckEmails: number;
}

/** B10 (OPS-05 groundwork): is a worker running, and are emails going out? Read by /api/health/worker and admins. */
export async function workerHealth(now = new Date()): Promise<WorkerHealth> {
  const lastSeen = await workerLastSeen(db);
  const workerSilent = !lastSeen || now.getTime() - lastSeen.getTime() > WORKER_SILENT_AFTER_MINUTES * MINUTE;
  const stuckEmails = await countWaitingEmails(db, new Date(now.getTime() - EMAIL_STUCK_AFTER_MINUTES * MINUTE));
  return { ok: !workerSilent && stuckEmails === 0, lastSeen, workerSilent, stuckEmails };
}

export interface EmailProblemView {
  id: string;
  label: string;
  userId: string;
  createdAt: string;
  attempts: number;
  state: "failed" | "retrying" | "stuck";
  reason: string;
  /** Why it can or can't be sent again, in plain words. */
  retry: { allowed: true } | { allowed: false; why: string };
}

/** /admin/emails: failed and stuck emails of the last 30 days, without any address or content (OPS-01). */
export async function emailOverview(actor: Actor, now = new Date()) {
  assertRole(actor, ["ADMIN"]);
  const problems = await emailProblems(db, {
    failedSince: new Date(now.getTime() - 30 * 24 * 60 * MINUTE),
    queuedBefore: new Date(now.getTime() - EMAIL_STUCK_AFTER_MINUTES * MINUTE),
    limit: 100,
  });
  const pending = await deliveriesWithPendingJobs(
    db,
    problems.filter((p) => p.status === "QUEUED").map((p) => p.id),
  );
  const items: EmailProblemView[] = problems.map((p) => {
    const state = p.status === "FAILED" ? "failed" : pending.has(p.id) ? "retrying" : "stuck";
    return {
      id: p.id,
      label: EMAIL_LABELS[p.template as EmailTemplate] ?? p.template,
      userId: p.userId,
      createdAt: p.createdAt.toISOString(),
      attempts: p.attempts,
      state,
      reason: describeError(p.lastError, state),
      retry: retryVerdict(p.template, p.createdAt, state, now),
    };
  });
  return { items, health: await workerHealth(now) };
}

/** An admin sends a stuck email again (audited). Only stuck emails qualify; see retryVerdict. */
export async function retryEmail(actor: Actor, deliveryId: string, now = new Date()): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const row = await findEmailDelivery(tx, deliveryId);
    if (!row) throw new NotFoundError("Email not found.");
    const pending = await deliveriesWithPendingJobs(tx, [row.id]);
    const stuck = now.getTime() - row.createdAt.getTime() > EMAIL_STUCK_AFTER_MINUTES * MINUTE;
    const state =
      row.status === "FAILED"
        ? "failed"
        : row.status !== "QUEUED"
          ? "done"
          : pending.has(row.id)
            ? "retrying"
            : stuck
              ? "stuck"
              : "retrying";
    const verdict = retryVerdict(row.template, row.createdAt, state, now);
    if (!verdict.allowed) throw new ConflictError(verdict.why);
    await enqueue(tx, "email.send", { deliveryId: row.id });
    await clearEmailAlert(tx, row.id);
    await audit(tx, actor, "email.retry", "EMAIL", row.id, { reason: `Sent again after ${row.attempts} tries` });
  });
}

function retryVerdict(
  template: string,
  createdAt: Date,
  state: "failed" | "retrying" | "stuck" | "done",
  now: Date,
): EmailProblemView["retry"] {
  if (state === "done") return { allowed: false, why: "This email has already been dealt with." };
  if (state === "failed")
    return {
      allowed: false,
      why: "The provider refused this email, or it couldn’t be built. Sending again won’t help.",
    };
  if (state === "retrying") return { allowed: false, why: "The worker is still trying to send it." };
  if (
    SIGN_IN_EMAILS.includes(template as EmailTemplate) &&
    now.getTime() - createdAt.getTime() > SIGN_IN_LINK_MINUTES * MINUTE
  )
    return { allowed: false, why: "Its sign-in link has expired. The person can ask for a new one." };
  return { allowed: true };
}

/** The stored code in plain words. Codes never hold the address or the provider's message. */
function describeError(code: string | null, state: EmailProblemView["state"]): string {
  if (!code) return state === "failed" ? "Unknown" : "Not tried yet: is the worker running?";
  if (code === "bad_template_data" || code === "render_error") return "The email couldn’t be built (a bug to fix).";
  if (/^resend_(401|403)/.test(code)) return `Resend refused the API key or the sending domain (${code}).`;
  if (/^resend_(400|422)/.test(code)) return `Resend refused this email, often a bad address (${code}).`;
  if (/^resend_429/.test(code)) return "Resend’s rate limit was hit.";
  if (/^(resend_5\d\d|resend_timeout|resend_network)/.test(code)) return `Resend couldn’t be reached (${code}).`;
  if (/^smtp_5\d\d/.test(code)) return `The mail server refused this email (${code}).`;
  if (/^smtp_/.test(code)) return `The mail server couldn’t be reached (${code}).`;
  return code;
}
