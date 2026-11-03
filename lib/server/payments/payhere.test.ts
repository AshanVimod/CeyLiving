// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseEnv, PAYHERE_DEV_KEYS } from "@/lib/env";
import {
  checkoutForm,
  checkoutHash,
  formatAmount,
  mapStatusCode,
  notificationSchema,
  notificationSignature,
  parseAmount,
  payhereApi,
  PayHereApiError,
  payhereSetup,
  signedNotification,
  storableFields,
  verifyNotification,
} from "./payhere";

// B08: the PayHere formulas and the status mapping, checked against values worked out by hand from PayHere's docs.

const env = (extra: Record<string, string> = {}) =>
  parseEnv({
    NODE_ENV: "test",
    PAYHERE_MERCHANT_ID: "1211149",
    PAYHERE_MERCHANT_SECRET: "MySecret123",
    ...extra,
  });

const notification = (overrides: Record<string, string> = {}) => ({
  merchant_id: "1211149",
  order_id: "ItemNo12345",
  payment_id: "320025071278",
  payhere_amount: "1000.00",
  payhere_currency: "LKR",
  status_code: "2",
  // UPPER(md5("1211149" + "ItemNo12345" + "1000.00" + "LKR" + "2" + UPPER(md5("MySecret123"))))
  md5sig: "4A3A4CD677B9DA257F1162EFC432726F",
  method: "VISA",
  status_message: "Successfully completed the payment.",
  ...overrides,
});

describe("request hash (PAY-02)", () => {
  it("PAY-02 matches PayHere's documented formula", () => {
    // UPPER(md5("1211149" + "ItemNo12345" + "1000.00" + "LKR" + UPPER(md5("MySecret123")))), worked out separately.
    expect(checkoutHash("ItemNo12345", 100_000, env())).toBe("67592FA10915DC796B49B21604867710");
  });

  it("PAY-02 the checkout form carries the hash but never the secret", () => {
    const form = checkoutForm(
      {
        orderNumber: "CM-2026-001001",
        amountCents: 345_050,
        items: "Clay pot",
        customer: {
          firstName: "Test",
          lastName: "Buyer",
          email: "t@example.lk",
          phone: "0771234567",
          address: "1 Lake Road",
          city: "Kandy",
        },
        returnUrl: "https://ceyliving.lk/checkout/result?order=CM-2026-001001",
        cancelUrl: "https://ceyliving.lk/checkout/pay/CM-2026-001001",
      },
      env({ SITE_URL: "https://ceyliving.lk" }),
    );
    expect(form.action).toBe("https://sandbox.payhere.lk/pay/checkout");
    expect(form.fields).toMatchObject({
      merchant_id: "1211149",
      order_id: "CM-2026-001001",
      amount: "3450.50",
      currency: "LKR",
      notify_url: "https://ceyliving.lk/api/payments/payhere/notify",
    });
    expect(form.fields.hash).toMatch(/^[0-9A-F]{32}$/);
    expect(JSON.stringify(form)).not.toContain("MySecret123");
  });

  it("live mode sends customers to www.payhere.lk (the www matters)", () => {
    expect(payhereSetup(env({ PAYHERE_MODE: "live" })).checkoutUrl).toBe("https://www.payhere.lk/pay/checkout");
  });

  it("without a merchant secret (development) the stand-in keys are used and flagged", () => {
    const setup = payhereSetup(parseEnv({ NODE_ENV: "test" }));
    expect(setup).toMatchObject({ merchantId: PAYHERE_DEV_KEYS.merchantId, standIn: true, hasApi: false });
  });

  it("PAY-02 production refuses missing or stand-in PayHere keys", () => {
    const production = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://a:b@db/c",
      BETTER_AUTH_SECRET: "x".repeat(40),
      SMTP_URL: "smtp://mail:25",
      CACHE_REFRESH_SECRET: "y".repeat(40),
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      SITE_URL: "https://ceyliving.lk",
    };
    expect(() => parseEnv(production)).toThrow("PAYHERE_MERCHANT_SECRET: is required in production");
    expect(() =>
      parseEnv({
        ...production,
        PAYHERE_MERCHANT_ID: PAYHERE_DEV_KEYS.merchantId,
        PAYHERE_MERCHANT_SECRET: PAYHERE_DEV_KEYS.merchantSecret,
      }),
    ).toThrow("must not be the development stand-in in production");
  });
});

describe("amounts in cents", () => {
  it("formats and parses without floating point", () => {
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(5)).toBe("0.05");
    expect(formatAmount(123_456_789)).toBe("1234567.89");
    expect(parseAmount("1234567.89")).toBe(123_456_789);
    expect(parseAmount("0.1")).toBe(10);
    expect(parseAmount("12")).toBe(1200);
    // 0.1 + 0.2 style errors can't happen: the digits are read as integers.
    expect(parseAmount("0.29")).toBe(29);
  });

  it("rejects anything that isn't a plain amount", () => {
    for (const bad of ["-1.00", "1,000.00", "1e3", "1.005", " 1.00", "", "abc"])
      expect(parseAmount(bad)).toBeUndefined();
    expect(() => formatAmount(1.5)).toThrow();
  });
});

describe("notification signature (PAY-03)", () => {
  it("PAY-03 a valid notification verifies", () => {
    const parsed = notificationSchema.parse(notification());
    expect(notificationSignature(parsed, env())).toBe(parsed.md5sig);
    expect(verifyNotification(parsed, env())).toEqual({ ok: true });
  });

  it("PAY-03 accepts the signature in lower case too", () => {
    const parsed = notificationSchema.parse(notification({ md5sig: notification().md5sig.toLowerCase() }));
    expect(verifyNotification(parsed, env())).toEqual({ ok: true });
  });

  it.each([
    ["payhere_amount", "1.00"],
    ["status_code", "0"],
    ["order_id", "ItemNo12346"],
    ["payhere_currency", "USD"],
  ])("PAY-03 changing %s breaks the signature", (field, value) => {
    const parsed = notificationSchema.parse(notification({ [field]: value }));
    expect(verifyNotification(parsed, env())).toEqual({ ok: false, reason: "signature" });
  });

  it("PAY-03 a notification for another merchant is refused", () => {
    const parsed = notificationSchema.parse(notification({ merchant_id: "1211150" }));
    expect(verifyNotification(parsed, env())).toEqual({ ok: false, reason: "merchant" });
  });

  it("PAY-03 the wrong secret fails", () => {
    const parsed = notificationSchema.parse(notification());
    expect(verifyNotification(parsed, env({ PAYHERE_MERCHANT_SECRET: "OtherSecret" }))).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("PAY-03 a malformed signature (wrong length or characters) is refused by the schema", () => {
    expect(notificationSchema.safeParse(notification({ md5sig: "ABC" })).success).toBe(false);
    expect(notificationSchema.safeParse(notification({ md5sig: "Z".repeat(32) })).success).toBe(false);
  });

  it("PAY-01 card fields are dropped and never stored", () => {
    const parsed = notificationSchema.parse({
      ...notification(),
      card_holder_name: "T BUYER",
      card_no: "************1292",
      card_expiry: "1229",
    });
    expect(parsed).not.toHaveProperty("card_no");
    const stored = storableFields(parsed);
    expect(Object.keys(stored).sort()).toEqual(
      [
        "merchant_id",
        "method",
        "order_id",
        "payhere_amount",
        "payhere_currency",
        "payment_id",
        "status_code",
        "status_message",
      ].sort(),
    );
  });

  it("signs a simulated notification the same way PayHere does", () => {
    const signed = signedNotification(
      {
        order_id: "ItemNo12345",
        payment_id: "320025071278",
        payhere_amount: "1000.00",
        payhere_currency: "LKR",
        status_code: "2",
      },
      env(),
    );
    expect(signed.md5sig).toBe(notification().md5sig);
  });
});

describe("status codes (PAY-05)", () => {
  it.each([
    ["2", "SUCCESS"],
    ["0", "PENDING"],
    ["-1", "CANCELLED"],
    ["-2", "FAILED"],
    ["-3", "CHARGEDBACK"],
  ])("PAY-05 status_code %s means %s", (code, status) => {
    expect(mapStatusCode(code)).toBe(status);
  });

  it("PAY-05 an unknown code maps to nothing", () => {
    for (const code of ["1", "3", "-4", "", "02"]) expect(mapStatusCode(code)).toBeUndefined();
  });
});

describe("Merchant API (PAY-07, PAY-08)", () => {
  const apiEnv = () => env({ PAYHERE_APP_ID: "app-id", PAYHERE_APP_SECRET: "app-secret" });

  function fakeFetch(answers: Record<string, () => Response>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(answers).find((path) => url.includes(path))!;
      return answers[key]!();
    }) as typeof fetch;
    return { impl, calls };
  }
  const json =
    (body: unknown, status = 200) =>
    () =>
      Response.json(body, { status });
  const token = json({ access_token: "tok", token_type: "bearer", expires_in: 599, scope: "SANDBOX" });

  it("is unavailable without an API key", () => {
    expect(payhereApi(env())).toBeUndefined();
  });

  it("PAY-07 refunds with a bearer token, sending a partial amount as PayHere expects", async () => {
    const { impl, calls } = fakeFetch({
      "/oauth/token": token,
      "/payment/refund": json({ status: 1, msg: "Successfully submitted the refund request", data: 147_258 }),
    });
    const api = payhereApi(apiEnv(), impl)!;
    await expect(
      api.refund({ paymentId: "320025071278", amountCents: 10_050, description: "Damaged" }),
    ).resolves.toEqual({ refundRef: "147258" });
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth/token"))!;
    expect(tokenCall.url).toBe("https://sandbox.payhere.lk/merchant/v1/oauth/token");
    expect((tokenCall.init!.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("app-id:app-secret").toString("base64")}`,
    );
    const refundCall = calls.find((c) => c.url.endsWith("/payment/refund"))!;
    expect((refundCall.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(refundCall.init!.body as string)).toEqual({
      payment_id: "320025071278",
      description: "Damaged",
      amount: "100.50",
    });
  });

  it("PAY-07 a refusal is 'refused'; no answer is 'unavailable' (the outcome is unknown)", async () => {
    const refused = payhereApi(
      apiEnv(),
      fakeFetch({ "/oauth/token": token, "/payment/refund": json({ status: -1, msg: "Error processing refund" }) })
        .impl,
    )!;
    await expect(refused.refund({ paymentId: "1", description: "x" })).rejects.toMatchObject({
      kind: "refused",
      message: "PayHere refused the refund: Error processing refund.",
    });
    const down = payhereApi(apiEnv(), (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch)!;
    const error = await down.paymentsOfOrder("CM-2026-001001").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayHereApiError);
    expect(error).toMatchObject({ kind: "unavailable" });
    expect(String(error)).not.toContain("app-secret");
  });

  it("PAY-08 reads PayHere's payments of an order", async () => {
    const { impl } = fakeFetch({
      "/oauth/token": token,
      "/payment/search": json({
        status: 1,
        msg: "Payments with order_id:CM-2026-001001",
        data: [
          {
            payment_id: 320027150501,
            order_id: "CM-2026-001001",
            date: "2026-11-02 10:12:01",
            description: "Clay pot",
            status: "RECEIVED",
            currency: "LKR",
            amount: 3450.5,
          },
        ],
      }),
    });
    await expect(payhereApi(apiEnv(), impl)!.paymentsOfOrder("CM-2026-001001")).resolves.toEqual([
      {
        paymentId: "320027150501",
        orderNumber: "CM-2026-001001",
        amountCents: 345_050,
        currency: "LKR",
        status: "RECEIVED",
      },
    ]);
  });
});
