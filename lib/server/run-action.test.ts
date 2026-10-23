// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "@/test/log-capture";

const capture = vi.hoisted(() => ({ current: null as ReturnType<typeof captureLogger> | null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-request-id": "req-abc" }) }));
vi.mock("./observability/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./observability/logger")>();
  return {
    ...actual,
    requestLogger: (headers: Headers, fields?: Record<string, unknown>) =>
      actual.requestLogger(headers, fields, capture.current!.logger),
  };
});

const { runAction } = await import("./run-action");
const { ConflictError } = await import("./errors");

beforeEach(() => {
  capture.current = captureLogger();
});

describe("OPS-03 runAction", () => {
  it("OPS-03 logs an unexpected error with the request ID and shows it as the reference", async () => {
    const result = await runAction(async () => {
      throw new Error("db exploded for nimal@example.lk");
    });
    expect(result).toEqual({
      ok: false,
      message: "Something went wrong on our side. Please try again. Reference: req-abc",
    });
    const line = capture.current!.lines.find((l) => l.msg === "action.failed");
    expect(line).toMatchObject({ level: "error", requestId: "req-abc", err: { message: "db exploded for [EMAIL]" } });
    expect(typeof line?.durationMs).toBe("number");
  });

  it("OPS-03 returns a domain error message unchanged and does not log it as an error", async () => {
    const result = await runAction(async () => {
      throw new ConflictError("That shop name is taken.");
    });
    expect(result).toEqual({ ok: false, message: "That shop name is taken.", fieldErrors: undefined });
    expect(capture.current!.lines.some((l) => l.level === "error")).toBe(false);
    expect(capture.current!.lines[0]).toMatchObject({ msg: "action.rejected", code: "CONFLICT", requestId: "req-abc" });
  });
});
