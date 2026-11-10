import "server-only";
import { NextRequest } from "next/server";
import { isAllowedOrigin } from "../security/origin";
import { countEvent } from "../services/ops";
import { requestLogger } from "./logger";
import { requestContextFrom, withRequestContext } from "./request-context";
import { REQUEST_ID_HEADER } from "./request-id";

type Handler = (request: NextRequest, log: ReturnType<typeof requestLogger>["log"]) => Promise<Response> | Response;

/** 12.2: the largest request body a route accepts unless it says otherwise. */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

export interface RouteOptions {
  /**
   * 12.2: state-changing requests must carry our own Origin. A route that browsers never call (signed or
   * secret-protected server-to-server calls) opts out with the reason, which is kept in the code for review.
   */
  origin?: { exempt: string };
  /** 12.2: the body limit in bytes, or "handler" when the handler enforces its own (and reads the stream itself). */
  bodyLimit?: number | "handler";
  /** Log successful responses at debug, not info (health checks an uptime monitor calls every minute). */
  quiet?: boolean;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * OPS-03: the route-handler counterpart of runAction. Logs every response with its status and duration;
 * an unexpected error is logged with the stack and answered with a generic 500 carrying the reference.
 * Every response gets the x-request-id header.
 *
 * 12.2 (B12), default-deny: every POST, PUT, PATCH and DELETE gets an Origin check and a 1 MB body limit unless the
 * route opts out, so a new route is protected without anyone remembering to add it.
 */
export function withRoute(route: string, handler: Handler, options: RouteOptions = {}) {
  return async (incoming: NextRequest): Promise<Response> => {
    const started = performance.now();
    const { requestId, log } = requestLogger(incoming.headers, { route });
    const durationMs = () => Math.round(performance.now() - started);
    const finish = (response: Response) => {
      response.headers.set(REQUEST_ID_HEADER, requestId);
      const level = options.quiet && response.status < 400 ? "debug" : "info";
      log[level]({ status: response.status, durationMs: durationMs() }, "route.completed");
      return response;
    };
    const refuse = (status: 403 | 413, event: "origin_rejected" | "body_too_large") => {
      log.warn({ event: `security.${event}`, status }, "route.refused");
      return finish(new Response(null, { status, headers: { "Cache-Control": "no-store" } }));
    };

    let request = incoming;
    if (MUTATING.has(incoming.method)) {
      if (!options.origin && !isAllowedOrigin(incoming.headers, incoming.url)) {
        await countEvent("origin_rejected");
        return refuse(403, "origin_rejected");
      }
      const limit = options.bodyLimit ?? DEFAULT_BODY_LIMIT_BYTES;
      if (limit !== "handler") {
        const body = await readLimited(incoming, limit);
        if (body === "too_large") {
          await countEvent("body_too_large");
          return refuse(413, "body_too_large");
        }
        request = new NextRequest(incoming.url, { method: incoming.method, headers: incoming.headers, body });
      }
    }

    let response: Response;
    try {
      response = await withRequestContext(requestContextFrom(incoming.headers, requestId), () => handler(request, log));
    } catch (error) {
      log.error({ err: error, durationMs: durationMs() }, "route.failed");
      await countEvent("server_error");
      return Response.json(
        { error: "Something went wrong on our side.", reference: requestId },
        { status: 500, headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" } },
      );
    }
    return finish(response);
  };
}

/**
 * 12.2: reads the body, stopping as soon as it passes `limit` bytes. A Content-Length over the limit is refused
 * before reading; a missing or false one doesn't help, because the bytes themselves are counted.
 */
async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null | "too_large"> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return "too_large";
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
