import "server-only";
import type { Email } from "./send";

// The two sign-in emails (B05a). Plain words, one link, no tracking. The link is the only dynamic part, and it is
// escaped for the HTML version.

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(heading: string, text: string, button: string, url: string, after: string): string {
  return `<!doctype html><html><body style="font-family:Georgia,serif;color:#13241c;background:#eef0e8;padding:24px">
<div style="max-width:520px;margin:auto;background:#f8f9f4;padding:32px;border-radius:8px">
<h1 style="font-size:24px;margin:0 0 16px">${heading}</h1>
<p style="font-family:Arial,sans-serif;line-height:1.5">${text}</p>
<p style="margin:28px 0"><a href="${escape(url)}" style="background:#1f4d3a;color:#f8f9f4;padding:12px 24px;border-radius:999px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">${button}</a></p>
<p style="font-family:Arial,sans-serif;font-size:13px;color:#46534b;line-height:1.5">${after}</p>
</div></body></html>`;
}

export function verifyEmailMessage(to: string, url: string): Email {
  const after =
    "The link works once and expires in 1 hour. If you didn’t create a CeyLiving account, ignore this email.";
  return {
    to,
    subject: "Confirm your email for CeyLiving",
    text: `Confirm your email to finish setting up your CeyLiving account:\n\n${url}\n\n${after}`,
    html: layout(
      "Confirm your email",
      "One click to finish setting up your CeyLiving account.",
      "Confirm email",
      url,
      after,
    ),
  };
}

export function resetPasswordMessage(to: string, url: string): Email {
  const after =
    "The link works once and expires in 1 hour. Setting a new password signs you out everywhere else. If you didn’t ask for this, ignore this email: your password stays the same.";
  return {
    to,
    subject: "Set a new CeyLiving password",
    text: `Choose a new password for your CeyLiving account:\n\n${url}\n\n${after}`,
    html: layout(
      "Set a new password",
      "Someone (hopefully you) asked to reset your CeyLiving password.",
      "Choose a new password",
      url,
      after,
    ),
  };
}
