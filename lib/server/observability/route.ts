import "server-only";
import type { NextRequest } from "next/server";
import { requestLogger } from "./logger";
import { REQUEST_ID_HEADER } from "./request-id";

type Handler = (request: NextRequest, log: ReturnType<typeof requestLogger>["log"]) => Promise<Response> | Response;

/**
 * OPS-03: the route-handler counterpart of runAction. Logs every response with its status and duration;
 * an unexpected error is logged with the stack and answered with a generic 500 carrying the reference.
 * Every response gets the x-request-id header.
 */
export function withRoute(route: string, handler: Handler) {
  return async (request: NextRequest): Promise<Response> => {
    const started = performance.now();
    const { requestId, log } = requestLogger(request.headers, { route });
    let response: Response;
    try {
      response = await handler(request, log);
    } catch (error) {
      log.error({ err: error, durationMs: Math.round(performance.now() - started) }, "route.failed");
      return Response.json(
        { error: "Something went wrong on our side.", reference: requestId },
        { status: 500, headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" } },
      );
    }
    response.headers.set(REQUEST_ID_HEADER, requestId);
    log.info({ status: response.status, durationMs: Math.round(performance.now() - started) }, "route.completed");
    return response;
  };
}
