import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/lib/env";
import { logger } from "../observability/logger";

// B05a: sends the sign-in emails (verify email, reset password) over SMTP: Mailpit locally, the provider's SMTP in
// production (required there by lib/env.ts). B10 moves email to the provider's API and the background worker.

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transport: { url: string; transporter: Transporter } | undefined;

export async function sendEmail(email: Email): Promise<void> {
  const env = getEnv();
  if (!env.SMTP_URL) {
    // Development without Mailpit: nothing is sent, and the address never reaches the logs (OPS-01).
    logger.warn({ subject: email.subject }, "email not sent: SMTP_URL is not set");
    return;
  }
  if (transport?.url !== env.SMTP_URL)
    transport = { url: env.SMTP_URL, transporter: nodemailer.createTransport(env.SMTP_URL) };
  await transport.transporter.sendMail({ from: env.EMAIL_FROM, ...email });
}
