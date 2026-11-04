import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/lib/env";

// B10: how an email leaves. `smtp` is Mailpit in development and tests (nothing leaves the computer); `resend` is
// the provider in production (backend plan D5). The worker is the only caller (lib/server/services/email.ts).
// Errors carry a short code and whether a retry can help, never the address, the email or the API key.

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The delivery id: Resend's Idempotency-Key, and the SMTP Message-ID, so a resend is recognisable (JOB-03). */
  deliveryId: string;
}

export interface EmailDriver {
  readonly name: "smtp" | "resend";
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/** A send that didn't happen. `retryable` false means the provider refused this email for good (JOB-04). */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Email not sent (${code})`);
    this.name = "EmailSendError";
  }
}

/** The domain part of the Message-ID; any fixed domain works, ours keeps it recognisable. */
const MESSAGE_ID_DOMAIN = "ceyliving.lk";

const TIMEOUT_MS = 15_000;

/** SMTP (Mailpit locally). 5xx replies are final; 4xx replies and connection problems are retried. */
export function smtpDriver(url: string): EmailDriver {
  const transporter: Transporter = nodemailer.createTransport({
    url,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  } as Parameters<typeof nodemailer.createTransport>[0]);
  return {
    name: "smtp",
    async send(email) {
      try {
        const info = await transporter.sendMail({
          from: email.from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          messageId: `<${email.deliveryId}@${MESSAGE_ID_DOMAIN}>`,
        });
        return { providerMessageId: info.messageId };
      } catch (error) {
        const responseCode = (error as { responseCode?: unknown }).responseCode;
        if (typeof responseCode === "number") throw new EmailSendError(`smtp_${responseCode}`, responseCode < 500);
        const code = (error as { code?: unknown }).code;
        throw new EmailSendError(`smtp_${typeof code === "string" ? safeCode(code) : "network"}`, true);
      }
    },
  };
}

export const RESEND_API_URL = "https://api.resend.com";

/**
 * Resend's HTTP API (one POST, no SDK). The Idempotency-Key makes a retry of an email Resend already accepted
 * return the first result instead of sending again (keys are kept 24 hours).
 */
export function resendDriver(apiKey: string, baseUrl = RESEND_API_URL): EmailDriver {
  return {
    name: "resend",
    async send(email) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": email.deliveryId,
          },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            subject: email.subject,
            html: email.html,
            text: email.text,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const timeout = (error as { name?: unknown }).name === "TimeoutError";
        throw new EmailSendError(timeout ? "resend_timeout" : "resend_network", true);
      }
      const body = (await response.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
      if (response.ok && typeof body.id === "string") return { providerMessageId: body.id };
      const name = typeof body.name === "string" ? `_${safeCode(body.name)}` : "";
      throw new EmailSendError(`resend_${response.status}${name}`, isRetryableStatus(response.status));
    },
  };
}

/**
 * 400 and 422 mean Resend refused this email (a bad address, content it won't send): retrying sends the same request
 * again, so it is final. Everything else is retried: 429 and 5xx get better by themselves, 409 means the same key
 * is still being processed, and 401/403 (key or domain set up wrong) need a person, whom the last try alerts.
 */
function isRetryableStatus(status: number): boolean {
  return !(status === 400 || status === 422 || (status >= 200 && status < 300));
}

/** Codes are kept on the row and in logs: lower-case letters, digits and underscores only, never free text. */
function safeCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 40);
}

let cached: { key: string; driver: EmailDriver } | undefined;

/** The driver the environment asks for, or undefined (development without Mailpit: emails are skipped). */
export function getEmailDriver(): EmailDriver | undefined {
  const env = getEnv();
  const key = env.EMAIL_DRIVER === "resend" ? `resend:${env.RESEND_API_KEY}` : `smtp:${env.SMTP_URL}`;
  if (cached?.key === key) return cached.driver;
  let driver: EmailDriver | undefined;
  if (env.EMAIL_DRIVER === "resend" && env.RESEND_API_KEY) driver = resendDriver(env.RESEND_API_KEY);
  else if (env.EMAIL_DRIVER === "smtp" && env.SMTP_URL) driver = smtpDriver(env.SMTP_URL);
  cached = driver ? { key, driver } : undefined;
  return driver;
}
