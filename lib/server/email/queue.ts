import "server-only";
import { withSavepoint, type Tx } from "../db/tx";
import { logger } from "../observability/logger";
import { insertEmailDelivery } from "../repositories/email";
import { enqueue } from "../repositories/jobs";
import { addNotifications, listAdminIds, newId } from "../repositories/people";
import { EMAILS, type EmailData, type EmailTemplate } from "./catalogue";

// B10 (backend plan 11.2): how services ask for an email. The row and its email.send job are written in the
// caller's transaction (JOB-02): a change that rolls back sends nothing. Sending happens later, in the worker.

export interface QueuedEmail<T extends EmailTemplate> {
  /** The recipient. Their address is read when the email is sent, so a changed address is used. */
  userId: string;
  /** What the email is about, e.g. a seller order id. With the template it is the dedupe key (JOB-03). */
  key: string;
  data: EmailData<T>;
  /** account.deleted only: the address before anonymising, which the worker could no longer read. */
  toAddress?: string;
}

/**
 * Queues one email in `tx`. The same template and key queue once however often they are asked for. Never throws:
 * an email that can't be queued is undone on its own (a savepoint), logged and reported to the admins, and the
 * caller's change still commits. An email is never worth losing an order or a payment over.
 */
export async function queueEmail<T extends EmailTemplate>(
  tx: Tx,
  template: T,
  email: QueuedEmail<T>,
): Promise<boolean> {
  const dedupeKey = `${template}:${email.key}`;
  try {
    return await withSavepoint(tx, "email_queue", async () => {
      const data = EMAILS[template].parse(email.data) as object;
      const id = newId("eml");
      const added = await insertEmailDelivery(tx, {
        id,
        dedupeKey,
        template,
        userId: email.userId,
        toAddress: email.toAddress,
        data,
      });
      if (added) await enqueue(tx, "email.send", { deliveryId: id });
      return added;
    });
  } catch (error) {
    logger.error({ err: error, template, dedupeKey }, "email.queue_failed");
    await tellAdmins(tx, template);
    return false;
  }
}

async function tellAdmins(tx: Tx, template: string): Promise<void> {
  try {
    await withSavepoint(tx, "email_queue_alert", async () => {
      const adminIds = await listAdminIds(tx);
      await addNotifications(
        tx,
        adminIds.map((userId) => ({
          userId,
          type: "email.queue_failed",
          title: `An email (${template}) couldn’t be queued and wasn’t sent. Check the web app logs.`,
          href: "/admin/emails",
        })),
      );
    });
  } catch (error) {
    logger.error({ err: error, template }, "email.queue_alert_failed");
  }
}
