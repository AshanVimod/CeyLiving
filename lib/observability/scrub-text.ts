// B12 (OPS-01, OPS-04): masks personal data inside free text: error messages and stacks in the logs, and every
// string in a Sentry event. No "server-only": the browser's Sentry set-up uses it too, and it holds no secrets or key
// names, only patterns.

const RULES: [RegExp, string][] = [
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]"],
  // PostgreSQL quoting the row it refused: Key (email)=(a@b.lk) already exists.
  [/Key \(([^)]*)\)=\([^)]*\)/g, "Key ($1)=([REDACTED])"],
  // Secrets in query strings or form bodies: token=…, code=…, password=…, secret=….
  [/\b(token|code|password|secret|signature|md5sig)=[^&\s"']+/gi, "$1=[REDACTED]"],
  // Sri Lankan phone numbers: +94 77 123 4567, 0771234567, 077-123-4567.
  [/(?:\+94|\b0)[\s-]?7\d(?:[\s-]?\d){7}\b/g, "[PHONE]"],
  // Bank account and card numbers: a run of 8 to 20 digits that isn't part of a longer word or id.
  [/(?<![\w-])\d{8,20}(?![\w-])/g, "[NUMBER]"],
];

export function scrubText(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
