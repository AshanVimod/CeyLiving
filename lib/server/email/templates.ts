import { formatDate, formatLkr } from "@/lib/format";
import type { EmailData, EmailTemplate } from "./catalogue";

// B10 (backend plan 11.2): the emails themselves. Plain words, one button, no tracking pixels or outside images.
// Templates are typed functions over `html` below, which escapes every value it is given: the worker runs with
// React's server-components build (tsx --conditions=react-server), where react-dom/server can't be loaded, so the
// templates don't use React. Each email has a plain-text version written next to its HTML.

/** Text already turned into safe HTML (made only by `html`). */
class Safe {
  constructor(readonly value: string) {}
}

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type Part = string | number | Safe | undefined | false | Part[];

function piece(part: Part): string {
  if (part === undefined || part === false) return "";
  if (Array.isArray(part)) return part.map(piece).join("");
  return part instanceof Safe ? part.value : escape(String(part));
}

/** HTML with every interpolated value escaped, unless it is itself the result of `html`. */
export function html(strings: TemplateStringsArray, ...parts: Part[]): Safe {
  return new Safe(strings.reduce((out, s, i) => out + s + (i < parts.length ? piece(parts[i]) : ""), ""));
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** What the template knows besides its data: who it is for and where the site is. */
export interface EmailContext {
  name: string;
  siteUrl: string;
}

interface Content {
  subject: string;
  heading: string;
  /** Paragraphs, already safe. */
  body: Safe[];
  button?: { label: string; url: string };
  after?: string;
  /** The same message as plain text. */
  text: string;
}

const COLORS = { ink: "#13241c", soft: "#46534b", page: "#eef0e8", card: "#f8f9f4", forest: "#1f4d3a" };

function layout(c: Content, ctx: EmailContext): RenderedEmail {
  const para = (p: Safe) =>
    html`<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;margin:0 0 14px">${p}</p>`;
  const button = c.button
    ? html`<p style="margin:28px 0">
        <a
          href="${c.button.url}"
          style="background:${COLORS.forest};color:${COLORS.card};padding:12px 24px;border-radius:999px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;display:inline-block"
          >${c.button.label}</a
        >
      </p>`
    : undefined;
  const after = c.after
    ? html`<p style="font-family:Arial,sans-serif;font-size:13px;color:${COLORS.soft};line-height:1.5;margin:0">
        ${c.after}
      </p>`
    : undefined;
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${c.subject}</title>
      </head>
      <body style="margin:0;background:${COLORS.page};color:${COLORS.ink}">
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          style="background:${COLORS.page};padding:24px 12px"
        >
          <tr>
            <td align="center">
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                style="max-width:520px;background:${COLORS.card};border-radius:8px"
              >
                <tr>
                  <td style="padding:32px">
                    <p style="font-family:Georgia,serif;font-size:18px;margin:0 0 20px;color:${COLORS.forest}">
                      CeyLiving
                    </p>
                    <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:normal;margin:0 0 16px">
                      ${c.heading}
                    </h1>
                    ${c.body.map(para)}${button}${after}
                  </td>
                </tr>
              </table>
              <p style="font-family:Arial,sans-serif;font-size:12px;color:${COLORS.soft};margin:16px 0 0">
                CeyLiving, crafts from Sri Lankan makers. You get this email because of your CeyLiving account.
              </p>
            </td>
          </tr>
        </table>
      </body>
    </html>`;
  const text = [
    `Hello ${ctx.name},`,
    "",
    c.text,
    ...(c.button ? ["", `${c.button.label}: ${c.button.url}`] : []),
    ...(c.after ? ["", c.after] : []),
    "",
    "CeyLiving",
  ].join("\n");
  return { subject: c.subject, html: page.value, text };
}

const hello = (ctx: EmailContext) => html`Hello ${ctx.name},`;

const KIND = { REVIEW: "review", QUESTION: "question", ANSWER: "answer" } as const;

const TEMPLATES: { [T in EmailTemplate]: (data: EmailData<T>, ctx: EmailContext) => Content } = {
  "auth.verify": ({ url }) => ({
    subject: "Confirm your email for CeyLiving",
    heading: "Confirm your email",
    body: [html`One click to finish setting up your CeyLiving account.`],
    button: { label: "Confirm email", url },
    after: "The link works once and expires in 1 hour. If you didn’t create a CeyLiving account, ignore this email.",
    text: "Confirm your email to finish setting up your CeyLiving account.",
  }),
  "auth.reset": ({ url }) => ({
    subject: "Set a new CeyLiving password",
    heading: "Set a new password",
    body: [html`Someone (hopefully you) asked to reset your CeyLiving password.`],
    button: { label: "Choose a new password", url },
    after:
      "The link works once and expires in 1 hour. Setting a new password signs you out everywhere else. If you didn’t ask for this, ignore this email: your password stays the same.",
    text: "Someone (hopefully you) asked to reset your CeyLiving password.",
  }),
  "application.decision": ({ decision, reason }, ctx) => {
    if (decision === "APPROVED")
      return {
        subject: "Your CeyLiving shop is approved",
        heading: "Your shop is approved",
        body: [
          html`Welcome to CeyLiving. Sign in again, then add your shop’s logo, banner and first items to start selling.`,
        ],
        button: { label: "Set up your shop", url: `${ctx.siteUrl}/seller` },
        text: "Your seller application is approved. Sign in again, then add your shop’s logo, banner and first items to start selling.",
      };
    const changes = decision === "NEEDS_CHANGES";
    const lead = changes
      ? "We’d like a few changes to your seller application before we decide."
      : "Thank you for applying to sell on CeyLiving. This time we can’t approve your application.";
    return {
      subject: changes ? "Changes requested on your seller application" : "Your seller application wasn’t approved",
      heading: changes ? "Changes requested" : "Application not approved",
      body: [html`${lead}`, ...(reason ? [html`Our note: ${reason}`] : [])],
      button: { label: "See your application", url: `${ctx.siteUrl}/account` },
      text: [lead, ...(reason ? [`Our note: ${reason}`] : [])].join("\n\n"),
    };
  },
  "order.placed": ({ orderNumber, totalCents, shopNames }, ctx) => {
    const lead = `We’ve received your payment of ${formatLkr(totalCents)} for order ${orderNumber}.`;
    const makers = `Made by ${shopNames.join(", ")}. Each maker accepts their part of the order, then sends it; we’ll email you at each step.`;
    return {
      subject: `Order ${orderNumber} is placed`,
      heading: "Thank you for your order",
      body: [html`${lead}`, html`${makers}`],
      button: { label: "View your order", url: `${ctx.siteUrl}/account/orders/${orderNumber}` },
      text: `${lead}\n\n${makers}`,
    };
  },
  "order.new": ({ orderNumber, sellerOrderId, subtotalCents, acceptDays }, ctx) => {
    const lead = `You have a new paid order, ${orderNumber}, worth ${formatLkr(subtotalCents)}.`;
    const deadline = `Please accept it within ${acceptDays} days. Orders not accepted in time are cancelled and the customer is refunded.`;
    return {
      subject: `New order ${orderNumber}: please accept it within ${acceptDays} days`,
      heading: "You have a new order",
      body: [html`${lead}`, html`${deadline}`],
      button: { label: "Open the order", url: `${ctx.siteUrl}/seller/orders/${sellerOrderId}` },
      text: `${lead}\n\n${deadline}`,
    };
  },
  "order.accepted": ({ orderNumber, shopName }, ctx) => {
    const lead = `${shopName} accepted your order ${orderNumber} and is getting it ready. We’ll email you when it’s on its way.`;
    return {
      subject: `${shopName} accepted order ${orderNumber}`,
      heading: "Your order was accepted",
      body: [html`${lead}`],
      button: { label: "View your order", url: `${ctx.siteUrl}/account/orders/${orderNumber}` },
      text: lead,
    };
  },
  "order.dispatched": ({ orderNumber, shopName, courierName, trackingRef }, ctx) => {
    const lead = `${shopName} has sent your order ${orderNumber}.`;
    const tracking = trackingRef
      ? `Courier: ${courierName}. Tracking reference: ${trackingRef}.`
      : `Courier: ${courierName}. The maker didn’t give a tracking reference.`;
    const confirm = "When it arrives, please confirm delivery on your order page.";
    return {
      subject: `Order ${orderNumber} is on its way`,
      heading: "Your order is on its way",
      body: [html`${lead}`, html`<strong>${tracking}</strong>`, html`${confirm}`],
      button: { label: "View your order", url: `${ctx.siteUrl}/account/orders/${orderNumber}` },
      text: `${lead}\n\n${tracking}\n\n${confirm}`,
    };
  },
  "order.delivered": ({ orderNumber, shopName, automatic }, ctx) => {
    const lead = automatic
      ? `Your order ${orderNumber} from ${shopName} was sent a week ago, so we’ve marked it delivered.`
      : `Thank you for confirming that your order ${orderNumber} from ${shopName} arrived.`;
    const review = "How was it? A short review helps the maker and other shoppers.";
    return {
      subject: `How was your order from ${shopName}?`,
      heading: "Your order was delivered",
      body: [html`${lead}`, html`${review}`],
      button: { label: "Write a review", url: `${ctx.siteUrl}/account/orders/${orderNumber}` },
      text: `${lead}\n\n${review}`,
    };
  },
  "payout.paid": ({ netCents, periodStart, periodEnd }, ctx) => {
    const lead = `We’ve sent ${formatLkr(netCents)} to your bank account for orders delivered ${formatDate(periodStart)} to ${formatDate(periodEnd)}.`;
    const timing = "Bank transfers usually arrive within 1 to 2 working days.";
    return {
      subject: `Your CeyLiving payout of ${formatLkr(netCents)} is on its way`,
      heading: "Your payout is sent",
      body: [html`${lead}`, html`${timing}`],
      button: { label: "See the statement", url: `${ctx.siteUrl}/seller/payouts` },
      text: `${lead}\n\n${timing}`,
    };
  },
  "payout.account_changed": ({ changedAt }, ctx) => {
    const lead = `The bank account your CeyLiving payouts go to was changed on ${formatDate(changedAt)}.`;
    const warning = "If this wasn’t you, contact us straight away and change your password.";
    return {
      subject: "Your CeyLiving payout bank account was changed",
      heading: "Your payout account was changed",
      body: [html`${lead}`, html`${warning}`],
      button: { label: "Check your payout details", url: `${ctx.siteUrl}/seller/payouts` },
      text: `${lead}\n\n${warning}`,
    };
  },
  "content.hidden": ({ action, kind, reason }, ctx) => {
    const what = KIND[kind];
    const lead =
      action === "auto"
        ? `One of your ${what}s was reported by several people, so it’s hidden while a moderator reviews it.`
        : action === "delete"
          ? `A moderator removed one of your ${what}s.`
          : `A moderator hid one of your ${what}s.`;
    const parts = [lead, ...(reason ? [`Reason: ${reason}`] : []), "Please keep posts kind, honest and on topic."];
    return {
      subject: action === "delete" ? `Your ${what} was removed` : `Your ${what} is hidden`,
      heading: action === "delete" ? `Your ${what} was removed` : `Your ${what} is hidden`,
      body: parts.map((p) => html`${p}`),
      button: { label: "Your posts", url: `${ctx.siteUrl}/account/questions` },
      text: parts.join("\n\n"),
    };
  },
  "account.deleted": () => {
    const lead =
      "Your CeyLiving account is deleted. Your name, email, phone number and addresses are removed. Order records are kept without them, as the law requires.";
    return {
      subject: "Your CeyLiving account is deleted",
      heading: "Your account is deleted",
      body: [html`${lead}`],
      after: "If you didn’t ask for this, contact us through the CeyLiving website straight away.",
      text: lead,
    };
  },
  "ops.alert": ({ label, measure, worse }, ctx) => {
    const lead = `${worse ? "Getting worse since the last alert: " : ""}${label} (${measure}).`;
    const next =
      "The Operations card on the admin dashboard shows the details. This alert repeats at most once an hour while it continues.";
    return {
      subject: `CeyLiving alert: ${label}`,
      heading: worse ? "An alert is getting worse" : "Something needs a look",
      body: [html`${lead}`, html`${next}`],
      button: { label: "Open the admin dashboard", url: `${ctx.siteUrl}/admin` },
      text: `${lead}\n\n${next}`,
    };
  },
};

/** Builds the email. `data` must already have passed the template's schema (EMAILS). */
export function renderEmail<T extends EmailTemplate>(
  template: T,
  data: EmailData<T>,
  ctx: EmailContext,
): RenderedEmail {
  const content = TEMPLATES[template](data, ctx);
  return layout({ ...content, body: [hello(ctx), ...content.body] }, ctx);
}
