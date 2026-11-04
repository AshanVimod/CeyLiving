import { inject } from "vitest";
import type { EmailDriver, OutgoingEmail } from "@/lib/server/email/drivers";
import { deliverEmail } from "@/lib/server/services/email";
import { migratorClient } from "./db";

// B10: reading emails back in tests. `emailCapture` delivers queued emails into a list, as the worker would, for
// tests about something else (sign-in links). `mailpit` reads what the real SMTP driver sent to the test Mailpit.

/** Email rows still waiting, oldest first. */
export async function queuedDeliveries() {
  return migratorClient().emailDelivery.findMany({
    where: { status: "QUEUED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export function emailCapture() {
  const sent: OutgoingEmail[] = [];
  const driver: EmailDriver = {
    name: "smtp",
    async send(email) {
      sent.push(email);
      return { providerMessageId: `<${email.deliveryId}@test>` };
    },
  };
  /** Sends every queued email through the capture driver and returns everything sent so far. */
  async function mail(): Promise<OutgoingEmail[]> {
    for (const row of await queuedDeliveries()) await deliverEmail(row.id, { driver });
    return sent;
  }
  return { sent, driver, mail };
}

export interface MailpitMessage {
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
  MessageID: string;
}

/** The test run's Mailpit (test/global-setup.ts). */
export function mailpit() {
  const { smtpUrl, apiUrl } = inject("mailpit");
  return {
    smtpUrl,
    /** Every message Mailpit holds for this delivery (Message-ID <deliveryId@ceyliving.lk>). */
    async messagesFor(deliveryId: string): Promise<MailpitMessage[]> {
      const list = (await (await fetch(`${apiUrl}/api/v1/messages?limit=1000`)).json()) as {
        messages: { ID: string; MessageID: string }[];
      };
      const ids = list.messages.filter((m) => m.MessageID === `${deliveryId}@ceyliving.lk`).map((m) => m.ID);
      return Promise.all(
        ids.map(async (id) => (await (await fetch(`${apiUrl}/api/v1/message/${id}`)).json()) as MailpitMessage),
      );
    },
  };
}
