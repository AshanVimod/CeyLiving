import "server-only";

// OPS-01: these keys are replaced with [REDACTED] wherever they appear: in log lines (up to two levels deep, see
// logger.ts) and, from B12, in Sentry events (at any depth, OPS-04). One list, so a key added for the logs is
// scrubbed from error reports too. Server-only: the browser bundle never carries it (B11 checks .next/static).
export const REDACTED_KEYS = [
  // Secrets
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "secret",
  "apiKey",
  "merchantSecret",
  "merchant_secret",
  "appSecret",
  "app_secret",
  // Card details PayHere sends with a notification (PAY-01); they are never stored, and never logged either
  "card_no",
  "card_holder_name",
  "card_expiry",
  "cookie",
  "cookies",
  "authorization",
  "set-cookie",
  // Bank details
  "accountNumber",
  "account_number",
  "payoutAccountMasked",
  // B11 (12.4): bank details and the keys that protect them (only ever by mistake: this code logs ids and outcomes)
  "accountNumberEnc",
  "account_number_enc",
  "accountName",
  "account_name",
  "accountLast4",
  "account_last4",
  "bankName",
  "bank_name",
  "branch",
  "FIELD_ENCRYPTION_KEY",
  "FIELD_ENCRYPTION_PREVIOUS_KEYS",
  // Contact details and addresses
  "email",
  "phone",
  "phoneNumber",
  "mobile",
  "address",
  "shippingAddress",
  "line1",
  "line2",
  "postalCode",
  // B10: an email's recipient and content (only ever by mistake: email jobs log ids and outcomes)
  "to",
  "toAddress",
  "html",
  "text",
];
