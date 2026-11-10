import { connection } from "next/server";
import { withRoute } from "@/lib/server/observability/route";

/**
 * OPS-05: liveness, for an uptime monitor or a container health check. 200 while the process can answer at all. It
 * doesn't touch the database, so a database outage doesn't make the platform restart a healthy process; that is
 * what /api/ready is for.
 */
export const GET = withRoute(
  "api.health",
  async () => {
    await connection(); // answer at request time, never from a build-time copy
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  { quiet: true },
);
