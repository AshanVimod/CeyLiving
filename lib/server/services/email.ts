import "server-only";
import { getEnv } from "@/lib/env";
import { db, withTx } from "../db/tx";
import { EMAILS, SIGN_IN_EMAILS, type EmailTemplate } from "../email/catalogue";
import { EmailSendError, getEmailDriver, type EmailDriver } from "../email/drivers";
import { renderEmail } from "../email/templates";
import {
  findEmailDelivery,
  markEmailFinal,
  markEmailsAlerted,
  markEmailSent,
  recordEmailAttempt,
  unalertedEmailProblems,
  type EmailDeliveryRow,
} from "../repositories/email";
import { addNotifications, findUserById, listAdminIds } from "../repositories/people";
import { EMAIL_STUCK_AFTER_MINUTES } from "./email-admin";

// B10 (backend plan 11.2, 10.2 email.send and email.watch): sending a queued email. Only the worker imports this
// file (it brings in the templates and the mail drivers); what admins see is in email-admin.ts.

const MINUTE = 60_000;

export type DeliveryOutcome =
  | { outcome: "sent"; provider: string }
  | { outcome: "failed" | "skipped"; code: string }
  | { outcome: "already-final" | "missing" };

/**
 * email.send: builds and sends one queued email. JOB-03: only a QUEUED row is sent, every status move is a
 * conditional update from QUEUED, and the delivery id is Resend's Idempotency-Key, so a run after a send that
 * wasn't recorded doesn't send again. A retryable failure is counted on the row and rethrown, so pg-boss retries
 * (JOB-04); a refused or unbuildable email is FAILED for good, and email.watch tells the admins.
 */
export async function deliverEmail(
  deliveryId: string,
  deps: { driver?: EmailDriver | null; now?: () => Date } = {},
): Promise<DeliveryOutcome> {
  const now = deps.now ?? (() => new Date());
  const row = await findEmailDelivery(db, deliveryId);
  if (!row) return { outcome: "missing" };
  if (row.status !== "QUEUED") return { outcome: "already-final" };

  const final = async (status: "FAILED" | "SKIPPED", code: string, attempted = false) => {
    await withTx((tx) => markEmailFinal(tx, row.id, { status, code, attempted }, now()));
    return { outcome: status === "FAILED" ? ("failed" as const) : ("skipped" as const), code };
  };

  const recipient = await recipientOf(row);
  if ("skip" in recipient) return final("SKIPPED", recipient.skip);

  const driver = deps.driver === undefined ? getEmailDriver() : deps.driver;
  // Development without Mailpit (no SMTP_URL). The worker refuses to start like this in production.
  if (!driver) return final("SKIPPED", "no_transport");

  const template = row.template as EmailTemplate;
  const schema = EMAILS[template];
  const parsed = schema?.safeParse(row.data);
  if (!parsed?.success) return final("FAILED", "bad_template_data");
  let email;
  try {
    email = renderEmail(template, parsed.data as never, { name: recipient.name, siteUrl: getEnv().SITE_URL });
  } catch {
    return final("FAILED", "render_error");
  }

  try {
    const sent = await driver.send({ ...email, from: getEnv().EMAIL_FROM, to: recipient.address, deliveryId: row.id });
    const recorded = await withTx((tx) =>
      markEmailSent(tx, row.id, { provider: driver.name, providerMessageId: sent.providerMessageId }, now()),
    );
    return recorded ? { outcome: "sent", provider: driver.name } : { outcome: "already-final" };
  } catch (error) {
    if (error instanceof EmailSendError && !error.retryable) return final("FAILED", error.code, true);
    const code = error instanceof EmailSendError ? error.code : "unexpected";
    await withTx((tx) => recordEmailAttempt(tx, row.id, code, now()));
    throw error instanceof EmailSendError ? error : new EmailSendError(code, true);
  }
}

/** Who the email goes to now: the stored address (account.deleted), or the person's current, confirmed address. */
async function recipientOf(row: EmailDeliveryRow): Promise<{ address: string; name: string } | { skip: string }> {
  const user = await findUserById(db, row.userId);
  if (row.toAddress) return { address: row.toAddress, name: "there" };
  if (!user || user.deletedAt) return { skip: "account_deleted" };
  if (!user.emailVerified && !SIGN_IN_EMAILS.includes(row.template as EmailTemplate)) return { skip: "unverified" };
  return { address: user.email, name: user.name };
}

/**
 * email.watch (every 15 minutes): emails that failed, or have waited longer than EMAIL_STUCK_AFTER_MINUTES, are
 * reported to the admins in one notification with a link to /admin/emails. Each problem is reported once.
 */
export async function watchEmails(now = new Date()): Promise<{ alerted: number }> {
  const stuckBefore = new Date(now.getTime() - EMAIL_STUCK_AFTER_MINUTES * MINUTE);
  return withTx(async (tx) => {
    const ids = await unalertedEmailProblems(tx, stuckBefore, 500);
    if (!ids.length) return { alerted: 0 };
    const adminIds = await listAdminIds(tx);
    await addNotifications(
      tx,
      adminIds.map((userId) => ({
        userId,
        type: "email.problem",
        title: `${ids.length} email${ids.length === 1 ? "" : "s"} failed or ${ids.length === 1 ? "is" : "are"} stuck. Check the email list.`,
        href: "/admin/emails",
      })),
    );
    await markEmailsAlerted(tx, ids, now);
    return { alerted: ids.length };
  });
}
