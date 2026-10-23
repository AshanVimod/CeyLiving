// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogger } from "@/test/log-capture";

const capture = vi.hoisted(() => ({ current: null as ReturnType<typeof captureLogger> | null }));

vi.mock("./logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./logger")>();
  return {
    ...actual,
    requestLogger: (headers: Headers, fields?: Record<string, unknown>) =>
      actual.requestLogger(headers, fields, capture.current!.logger),
  };
});

const { withRoute } = await import("./route");

const request = () => new NextRequest("http://localhost:3000/api/x", { headers: { "x-request-id": "req-route" } });

beforeEach(() => {
  capture.current = captureLogger();
});

describe("OPS-03 withRoute", () => {
  it("OPS-03 returns 500 with the reference, logs route.failed and sets x-request-id", async () => {
    const GET = withRoute("api.x", () => {
      throw new Error("boom");
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req-route");
    expect(await response.json()).toEqual({ error: "Something went wrong on our side.", reference: "req-route" });
    expect(capture.current!.lines[0]).toMatchObject({
      level: "error",
      msg: "route.failed",
      route: "api.x",
      requestId: "req-route",
      err: { message: "boom" },
    });
  });

  it("OPS-03 logs the status and duration of a normal response and sets x-request-id", async () => {
    const GET = withRoute("api.x", () => Response.json({ ok: true }, { status: 201 }));
    const response = await GET(request());
    expect(response.headers.get("x-request-id")).toBe("req-route");
    expect(capture.current!.lines[0]).toMatchObject({ msg: "route.completed", status: 201, route: "api.x" });
    expect(typeof capture.current!.lines[0].durationMs).toBe("number");
  });
});
