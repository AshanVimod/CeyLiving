import { z } from "zod";

// B10 (backend plan 11.2): every email the app sends and the data its template needs. Services import this file to
// queue an email (lib/server/email/queue.ts); only the worker renders (templates.ts). Data holds what the email
// shows and nothing more: no addresses, phone numbers or bank details. The recipient's name and address are read
// when the email is sent.

const text = (max: number) => z.string().min(1).max(max);
const orderNumber = text(40);
const shopName = text(120);
/** Sign-in links (verify, reset): our own site's address with a one-time token. */
const link = z.url({ protocol: /^https?$/ }).max(2000);

export const EMAILS = {
  "auth.verify": z.object({ url: link }),
  "auth.reset": z.object({ url: link }),
  "application.decision": z.object({
    decision: z.enum(["APPROVED", "REJECTED", "NEEDS_CHANGES"]),
    reason: text(1000).optional(),
  }),
  /** To the customer, once the payment is confirmed (PayHere notify). */
  "order.placed": z.object({ orderNumber, totalCents: z.number().int().min(0), shopNames: z.array(shopName).min(1) }),
  /** To each maker in the order: accept it within the deadline (BR-08). */
  "order.new": z.object({
    orderNumber,
    sellerOrderId: text(100),
    subtotalCents: z.number().int().min(0),
    acceptDays: z.number().int().min(1),
  }),
  "order.accepted": z.object({ orderNumber, shopName }),
  "order.dispatched": z.object({ orderNumber, shopName, courierName: text(120), trackingRef: text(120).optional() }),
  /** Delivered (by the customer, or BR-17 after 7 days) and an invitation to review (RULE-R1). */
  "order.delivered": z.object({ orderNumber, shopName, automatic: z.boolean() }),
  "payout.paid": z.object({ netCents: z.number().int(), periodStart: z.iso.datetime(), periodEnd: z.iso.datetime() }),
  "content.hidden": z.object({
    action: z.enum(["hide", "delete", "auto"]),
    kind: z.enum(["REVIEW", "QUESTION", "ANSWER"]),
    reason: text(1000).optional(),
  }),
  /** Sent to the address the account had before it was anonymised (FR-17). */
  "account.deleted": z.object({}),
} as const satisfies Record<string, z.ZodType<object>>;

export type EmailTemplate = keyof typeof EMAILS;
export type EmailData<T extends EmailTemplate> = z.input<(typeof EMAILS)[T]>;

export const EMAIL_TEMPLATES = Object.keys(EMAILS) as EmailTemplate[];

/** Emails that carry a sign-in link. They go to unverified addresses too, and their link dies after an hour. */
export const SIGN_IN_EMAILS: readonly EmailTemplate[] = ["auth.verify", "auth.reset"];

/** What admins see on /admin/emails instead of the email itself. */
export const EMAIL_LABELS: Record<EmailTemplate, string> = {
  "auth.verify": "Confirm email",
  "auth.reset": "Reset password",
  "application.decision": "Seller application decision",
  "order.placed": "Order placed (customer)",
  "order.new": "New paid order (maker)",
  "order.accepted": "Order accepted",
  "order.dispatched": "Order dispatched",
  "order.delivered": "Delivered, review invitation",
  "payout.paid": "Payout sent",
  "content.hidden": "Post hidden or removed",
  "account.deleted": "Account deleted",
};
