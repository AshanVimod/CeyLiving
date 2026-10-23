import "server-only";
import pino, { type DestinationStream, type Level, type Logger } from "pino";
import { getEnv } from "@/lib/env";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

// OPS-01: these keys are replaced with [REDACTED] wherever they appear, up to two levels deep.
const REDACTED_KEYS = [
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
  "cookie",
  "cookies",
  "authorization",
  "set-cookie",
  // Bank details
  "accountNumber",
  "account_number",
  "payoutAccountMasked",
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
];

// Pino's "*" matches exactly one level, so each depth is listed. Bracket notation copes with "set-cookie".
export const REDACT_PATHS = REDACTED_KEYS.flatMap((key) => {
  const k = `["${key}"]`;
  return [k, `*${k}`, `*.*${k}`];
});

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Error messages often quote input ("no account for a@b.lk"), so email addresses are masked there too. */
function serializeError(error: unknown) {
  if (!(error instanceof Error)) return error;
  const out = pino.stdSerializers.err(error);
  out.message = out.message.replace(EMAIL, "[EMAIL]");
  if (out.stack) out.stack = out.stack.replace(EMAIL, "[EMAIL]");
  return out;
}

export interface LoggerOptions {
  level?: Level | "silent";
  destination?: DestinationStream;
}

/** One JSON object per line: level, time, service, msg, plus the fields each call adds (OPS-01). */
export function createLogger({ level, destination }: LoggerOptions = {}): Logger {
  const env = getEnv();
  return pino(
    {
      level: level ?? env.LOG_LEVEL ?? (env.NODE_ENV === "test" ? "silent" : "info"),
      base: { service: "ceyliving-web" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: serializeError },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    destination,
  );
}

export const logger = createLogger();

/**
 * A child logger carrying this request's ID (OPS-02). Falls back to a fresh ID if proxy.ts did not run,
 * so no log line is ever without one.
 */
export function requestLogger(headers: Headers, fields: Record<string, unknown> = {}, base: Logger = logger) {
  const requestId = headers.get(REQUEST_ID_HEADER) ?? resolveRequestId(headers);
  return { requestId, log: base.child({ requestId, ...fields }) };
}
