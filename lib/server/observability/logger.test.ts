// @vitest-environment node
import { describe, expect, it } from "vitest";
import { captureLogger } from "@/test/log-capture";
import { requestLogger } from "./logger";

describe("OPS-01 logger", () => {
  it("OPS-01 writes one JSON line with level, time, service, msg and requestId", () => {
    const { logger, lines, raw } = captureLogger();
    const { log } = requestLogger(new Headers({ "x-request-id": "req-123" }), { route: "test" }, logger);
    log.info({ durationMs: 4 }, "route.completed");
    expect(raw).toHaveLength(1);
    expect(raw[0].endsWith("\n")).toBe(true);
    expect(lines[0]).toMatchObject({
      level: "info",
      service: "ceyliving-web",
      msg: "route.completed",
      requestId: "req-123",
      route: "test",
      durationMs: 4,
    });
    expect(new Date(lines[0].time as string).toISOString()).toBe(lines[0].time);
  });

  it("OPS-01 redacts passwords, tokens, cookies and authorization headers, nested two levels deep", () => {
    const { logger, raw } = captureLogger();
    logger.info(
      {
        password: "hunter2-secret",
        token: "tok-secret",
        input: { newPassword: "pw-secret", apiKey: "key-secret" },
        req: {
          headers: { authorization: "Bearer auth-secret", cookie: "sid=cookie-secret", "set-cookie": "a=sc-secret" },
        },
      },
      "signin",
    );
    for (const secret of [
      "hunter2",
      "tok-secret",
      "pw-secret",
      "key-secret",
      "auth-secret",
      "cookie-secret",
      "sc-secret",
    ]) {
      expect(raw[0]).not.toContain(secret);
    }
    expect(raw[0]).toContain("[REDACTED]");
  });

  it("OPS-01 redacts email, phone, address and account-number fields", () => {
    const { logger, lines, raw } = captureLogger();
    logger.info(
      {
        email: "nimal@example.lk",
        user: { phone: "+94771234567", accountNumber: "0012345678" },
        order: { shippingAddress: { line1: "12 Temple Road", city: "Kandy" } },
        payout: { details: { account_number: "998877" } },
      },
      "order.placed",
    );
    for (const value of ["nimal@example.lk", "+94771234567", "0012345678", "12 Temple Road", "998877"]) {
      expect(raw[0]).not.toContain(value);
    }
    expect(lines[0]).toMatchObject({ email: "[REDACTED]", order: { shippingAddress: "[REDACTED]" } });
  });

  it("OPS-01 masks email addresses inside error messages and stacks", () => {
    const { logger, lines, raw } = captureLogger();
    logger.error({ err: new Error("no account for nimal@example.lk") }, "action.failed");
    expect(raw[0]).not.toContain("nimal@example.lk");
    expect(lines[0]).toMatchObject({ err: { type: "Error", message: "no account for [EMAIL]" } });
    expect((lines[0].err as { stack: string }).stack).toContain("[EMAIL]");
  });

  it("OPS-02 generates a request ID when proxy.ts did not set one", () => {
    const { requestId } = requestLogger(new Headers());
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
