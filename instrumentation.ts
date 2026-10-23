import type { Instrumentation } from "next";

// Runs once when the server starts, before it handles requests (Next.js instrumentation).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 12.3: fail fast on a missing or malformed environment variable. Next.js would otherwise keep
    // listening and answer every request with a 500, so print the problems and exit.
    // console, not the logger: the logger itself reads the environment.
    const { assertEnv, EnvError } = await import("./lib/env");
    try {
      assertEnv();
    } catch (error) {
      if (!(error instanceof EnvError)) throw error;
      console.error(error.message);
      process.exit(1);
    }
  }
}

/**
 * OPS-02/OPS-03: errors Next.js catches itself (rendering, uncaught route and action errors) are logged with
 * the request ID and the digest that app/error.tsx shows as the reference, so one can be traced to the other.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./lib/server/observability/logger");
  const { REQUEST_ID_HEADER } = await import("./lib/server/observability/request-id");
  const header = request.headers[REQUEST_ID_HEADER];
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  logger.error(
    {
      err: error,
      requestId: Array.isArray(header) ? header[0] : header,
      digest,
      method: request.method,
      path: request.path.split("?")[0],
      routePath: context.routePath,
      routeType: context.routeType,
    },
    "request.failed",
  );
};
