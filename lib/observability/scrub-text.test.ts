import { describe, expect, it } from "vitest";
import { scrubText } from "./scrub-text";

// B12 (OPS-01, OPS-04): personal data quoted inside free text is masked before it reaches a log line or Sentry.

describe("OPS-04 scrubText", () => {
  it.each([
    ["no account for nimali.silva@example.lk", "no account for [EMAIL]"],
    ["call +94 77 123 4567 or 0771234567 or 077-123-4567", "call [PHONE] or [PHONE] or [PHONE]"],
    ["GET /reset?token=abc.def-123&next=/account", "GET /reset?token=[REDACTED]&next=/account"],
    ["password=xxxxxxxx md5sig=ABCDEF", "password=[REDACTED] md5sig=[REDACTED]"],
    ["account 7391058246 at Bank of Ceylon", "account [NUMBER] at Bank of Ceylon"],
    [
      "Unique constraint failed: Key (email)=(a@b.lk) already exists",
      "Unique constraint failed: Key (email)=([REDACTED]) already exists",
    ],
  ])("OPS-04 masks %j", (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it("OPS-04 leaves ids, request ids, line numbers and amounts alone", () => {
    const text = "order CL-2026-000123, request 8f3c1a2b-4d5e-6f70-8a9b-0c1d2e3f4a5b, at app.ts:120:7, LKR 12,500";
    expect(scrubText(text)).toBe(text);
  });
});
