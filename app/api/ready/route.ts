import { connection } from "next/server";
import { withRoute } from "@/lib/server/observability/route";
import { readiness } from "@/lib/server/services/health";

/**
 * OPS-05: readiness. 200 when the database answers within 2 seconds and this build's expected migration is applied;
 * 503 otherwise. The body is only `{ ok }`: why it failed is in the log line `ready.failed`, never in the answer.
 */
export const GET = withRoute(
  "api.ready",
  async (_request, log) => {
    await connection(); // read the database at request time, never at build time
    const result = await readiness();
    if (!result.ok) log.warn({ reason: result.reason, detail: result.detail }, "ready.failed");
    return Response.json(
      { ok: result.ok },
      { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  },
  { quiet: true },
);
