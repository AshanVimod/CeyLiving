import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv, PAYHERE_DEV_KEYS, type Env } from "@/lib/env";
import type { ProviderPaymentStatus } from "@/lib/types";

// B08: everything PayHere-specific (backend plan 9.2). Formulas and field names follow PayHere's developer docs
// (support.payhere.lk, Checkout API, Refund API, Retrieval API; checked 2026-11-03). The merchant secret is read
// from the environment inside this file only and is never returned, logged or put in an error (PAY-02).

export const PAYHERE_PROVIDER = "PAYHERE" as const;
export const PAYHERE_CURRENCY = "LKR";

const HOSTS = { sandbox: "https://sandbox.payhere.lk", live: "https://www.payhere.lk" } as const;

const md5Upper = (value: string) => createHash("md5").update(value, "utf8").digest("hex").toUpperCase();

/** What the rest of the app may know about the PayHere setup. No secrets here. */
export interface PayHereSetup {
  merchantId: string;
  mode: "sandbox" | "live";
  /** The host customers are sent to; next.config.ts allows form posts to it. */
  host: string;
  checkoutUrl: string;
  notifyUrl: string;
  /** True with the development stand-in keys: PayHere would refuse them, only the simulator can pay. */
  standIn: boolean;
  /** Whether the Merchant API (refunds, reconciliation) is configured. */
  hasApi: boolean;
}

export function payhereSetup(env: Env = getEnv()): PayHereSetup {
  const merchantId = env.PAYHERE_MERCHANT_ID ?? PAYHERE_DEV_KEYS.merchantId;
  const host = HOSTS[env.PAYHERE_MODE];
  return {
    merchantId,
    mode: env.PAYHERE_MODE,
    host,
    checkoutUrl: `${host}/pay/checkout`,
    notifyUrl: env.PAYHERE_NOTIFY_URL ?? `${env.SITE_URL}/api/payments/payhere/notify`,
    standIn: !env.PAYHERE_MERCHANT_SECRET,
    hasApi: Boolean(env.PAYHERE_APP_ID && env.PAYHERE_APP_SECRET),
  };
}

/** UPPER(md5(merchant_secret)): the part of both hashes that proves we know the secret. */
function secretDigest(env: Env): string {
  return md5Upper(env.PAYHERE_MERCHANT_SECRET ?? PAYHERE_DEV_KEYS.merchantSecret);
}

// ---------- Amounts (integer cents, never floats) ----------

const AMOUNT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** 123450 → "1234.50": two decimals, a dot, no thousands separator (PayHere's hash needs exactly this). */
export function formatAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("An amount must be a whole number of cents.");
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "1234.50" → 123450. Anything else (signs, exponents, separators, 3+ decimals) → undefined. */
export function parseAmount(value: string): number | undefined {
  const match = AMOUNT.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
}

// ---------- Checkout (backend plan 9.1 step 5) ----------

export interface CheckoutRequest {
  orderNumber: string;
  amountCents: number;
  items: string;
  customer: { firstName: string; lastName: string; email: string; phone: string; address: string; city: string };
  returnUrl: string;
  cancelUrl: string;
}

/** PAY-02: UPPER(md5(merchant_id + order_id + amount + currency + UPPER(md5(merchant_secret)))). */
export function checkoutHash(orderNumber: string, amountCents: number, env: Env = getEnv()): string {
  const { merchantId } = payhereSetup(env);
  return md5Upper(merchantId + orderNumber + formatAmount(amountCents) + PAYHERE_CURRENCY + secretDigest(env));
}

/** The hidden fields of the form that sends the customer to PayHere's own page (PAY-01: cards are entered there). */
export function checkoutForm(request: CheckoutRequest, env: Env = getEnv()) {
  const setup = payhereSetup(env);
  const fields: Record<string, string> = {
    merchant_id: setup.merchantId,
    return_url: request.returnUrl,
    cancel_url: request.cancelUrl,
    notify_url: setup.notifyUrl,
    order_id: request.orderNumber,
    items: request.items,
    currency: PAYHERE_CURRENCY,
    amount: formatAmount(request.amountCents),
    first_name: request.customer.firstName,
    last_name: request.customer.lastName,
    email: request.customer.email,
    phone: request.customer.phone,
    address: request.customer.address,
    city: request.customer.city,
    country: "Sri Lanka",
    hash: checkoutHash(request.orderNumber, request.amountCents, env),
  };
  return { action: setup.checkoutUrl, fields };
}

// ---------- Notifications (PAY-03) ----------

/**
 * The fields of PayHere's notification that CeyLiving reads. Everything else, card_holder_name, card_no and
 * card_expiry included, is dropped here and never stored or logged (PAY-01). status_code stays the string PayHere
 * sent, because md5sig is computed over it.
 */
export const notificationSchema = z.object({
  merchant_id: z.string().regex(/^\d{1,20}$/),
  order_id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  payment_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  payhere_amount: z.string().regex(AMOUNT),
  payhere_currency: z.string().regex(/^[A-Z]{3}$/),
  status_code: z.string().regex(/^-?\d{1,2}$/),
  md5sig: z.string().regex(/^[0-9A-Fa-f]{32}$/),
  status_message: z.string().max(500).optional(),
  method: z.string().max(32).optional(),
});

export type PayHereNotification = z.output<typeof notificationSchema>;

/** The notification fields worth keeping (payments.raw): everything parsed except the signature. */
export function storableFields(notification: PayHereNotification): Record<string, string> {
  return Object.fromEntries(
    Object.entries(notification).filter(([key, value]) => key !== "md5sig" && value !== undefined),
  ) as Record<string, string>;
}

type SignedFields = Pick<
  PayHereNotification,
  "merchant_id" | "order_id" | "payhere_amount" | "payhere_currency" | "status_code"
>;

/** UPPER(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(md5(secret)))). */
export function notificationSignature(fields: SignedFields, env: Env = getEnv()): string {
  return md5Upper(
    fields.merchant_id +
      fields.order_id +
      fields.payhere_amount +
      fields.payhere_currency +
      fields.status_code +
      secretDigest(env),
  );
}

/** Constant-time comparison of two hex strings (case-insensitive); different lengths are simply unequal. */
function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a.toUpperCase(), "utf8");
  const right = Buffer.from(b.toUpperCase(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type Verification = { ok: true } | { ok: false; reason: "merchant" | "signature" };

/** PAY-03: the notification is ours (merchant_id) and signed with our secret (md5sig, compared in constant time). */
export function verifyNotification(notification: PayHereNotification, env: Env = getEnv()): Verification {
  const expected = notificationSignature(notification, env);
  // Both checks always run, so the time taken doesn't say which one failed.
  const merchantOk = sameHex(notification.merchant_id, payhereSetup(env).merchantId);
  const signatureOk = sameHex(notification.md5sig, expected);
  if (!merchantOk) return { ok: false, reason: "merchant" };
  if (!signatureOk) return { ok: false, reason: "signature" };
  return { ok: true };
}

/** PAY-05: PayHere's status_code → our payment status. The only place codes are interpreted. */
export function mapStatusCode(code: string): ProviderPaymentStatus | undefined {
  switch (code) {
    case "2":
      return "SUCCESS";
    case "0":
      return "PENDING";
    case "-1":
      return "CANCELLED";
    case "-2":
      return "FAILED";
    case "-3":
      return "CHARGEDBACK";
    default:
      return undefined;
  }
}

/** A correctly signed notification, as PayHere would send it. For the dev-only simulator and tests. */
export function signedNotification(
  fields: Omit<PayHereNotification, "md5sig" | "merchant_id">,
  env: Env = getEnv(),
): PayHereNotification {
  const unsigned = { ...fields, merchant_id: payhereSetup(env).merchantId };
  return { ...unsigned, md5sig: notificationSignature(unsigned, env) };
}

// ---------- Merchant API: refunds (PAY-07) and payment search (PAY-08) ----------

/**
 * refused: PayHere answered and said no (nothing happened). unavailable: no answer, or one we couldn't read, so the
 * outcome is unknown and must be checked in PayHere before trying again.
 */
export class PayHereApiError extends Error {
  constructor(
    message: string,
    readonly kind: "refused" | "unavailable",
  ) {
    super(message);
    this.name = "PayHereApiError";
  }
}

/** One payment as PayHere's Retrieval API reports it. */
export interface RemotePayment {
  paymentId: string;
  orderNumber: string;
  amountCents: number | undefined;
  currency: string;
  /** RECEIVED, REFUND REQUESTED, REFUND PROCESSING, REFUNDED or CHARGEBACKED. */
  status: string;
}

export interface PayHereApi {
  refund(input: { paymentId: string; amountCents?: number; description: string }): Promise<{ refundRef: string }>;
  paymentsOfOrder(orderNumber: string): Promise<RemotePayment[]>;
}

const API_TIMEOUT_MS = 10_000;
/** PayHere allows 20 Merchant API calls per 10 seconds; one per 600 ms stays under it. */
const API_MIN_GAP_MS = 600;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
let nextCallAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextCallAt - now);
  nextCallAt = Math.max(now, nextCallAt) + API_MIN_GAP_MS;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
}

/** The Merchant API client, or undefined when PAYHERE_APP_ID / PAYHERE_APP_SECRET aren't set. */
export function payhereApi(env: Env = getEnv(), fetchImpl: typeof fetch = fetch): PayHereApi | undefined {
  const appId = env.PAYHERE_APP_ID;
  const appSecret = env.PAYHERE_APP_SECRET;
  if (!appId || !appSecret) return undefined;
  const base = `${HOSTS[env.PAYHERE_MODE]}/merchant/v1`;

  async function call(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    await throttle();
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch {
      throw new PayHereApiError("PayHere didn't answer in time.", "unavailable");
    }
    const body: unknown = await response.json().catch(() => undefined);
    return { status: response.status, body };
  }

  async function token(force = false): Promise<string> {
    const cached = tokenCache.get(appId!);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
    const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const { status, body } = await call("/oauth/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number() }).safeParse(body);
    if (!parsed.success) throw new PayHereApiError(`PayHere refused the API key (HTTP ${status}).`, "refused");
    // Renew 30 seconds early so a token never expires mid-call.
    tokenCache.set(appId!, {
      token: parsed.data.access_token,
      expiresAt: Date.now() + Math.max(0, parsed.data.expires_in - 30) * 1000,
    });
    return parsed.data.access_token;
  }

  /** A Merchant API call with a bearer token; an expired token is renewed once. */
  async function authorised(path: string, init: RequestInit): Promise<unknown> {
    for (const force of [false, true]) {
      const { status, body } = await call(path, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${await token(force)}`, "Content-Type": "application/json" },
      });
      const error = (body as { error?: unknown } | undefined)?.error;
      if (error === "invalid_token" && !force) continue;
      if (status >= 500) throw new PayHereApiError(`PayHere had an error (HTTP ${status}).`, "unavailable");
      return body;
    }
    throw new PayHereApiError("PayHere refused the access token.", "refused");
  }

  const answer = z.object({ status: z.number(), msg: z.string().optional(), data: z.unknown().optional() });

  return {
    async refund({ paymentId, amountCents, description }) {
      const body = await authorised("/payment/refund", {
        method: "POST",
        body: JSON.stringify({
          payment_id: paymentId,
          description,
          ...(amountCents !== undefined && { amount: formatAmount(amountCents) }),
        }),
      });
      const parsed = answer.safeParse(body);
      if (!parsed.success) throw new PayHereApiError("PayHere's answer couldn't be read.", "unavailable");
      if (parsed.data.status !== 1) {
        throw new PayHereApiError(`PayHere refused the refund: ${parsed.data.msg ?? "no reason given"}.`, "refused");
      }
      return { refundRef: String(parsed.data.data ?? "") || `PAYHERE-${paymentId}` };
    },

    async paymentsOfOrder(orderNumber) {
      const body = await authorised(`/payment/search?order_id=${encodeURIComponent(orderNumber)}`, { method: "GET" });
      const parsed = answer.safeParse(body);
      if (!parsed.success) throw new PayHereApiError("PayHere's answer couldn't be read.", "unavailable");
      if (parsed.data.status === -1) return []; // no records
      if (parsed.data.status !== 1) {
        throw new PayHereApiError(`PayHere refused the search: ${parsed.data.msg ?? "no reason given"}.`, "refused");
      }
      const rows = z
        .array(
          z.object({
            payment_id: z.union([z.string(), z.number()]),
            order_id: z.string(),
            amount: z.union([z.string(), z.number()]),
            currency: z.string(),
            status: z.string(),
          }),
        )
        .safeParse(parsed.data.data);
      if (!rows.success) throw new PayHereApiError("PayHere's payment list couldn't be read.", "unavailable");
      return rows.data.map((row) => ({
        paymentId: String(row.payment_id),
        orderNumber: row.order_id,
        amountCents: parseAmount(Number(row.amount).toFixed(2)),
        currency: row.currency,
        status: row.status,
      }));
    },
  };
}
