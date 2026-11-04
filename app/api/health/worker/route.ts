import { connection } from "next/server";
import { withRoute } from "@/lib/server/observability/route";
import { workerHealth } from "@/lib/server/services/email-admin";

/**
 * B10 (OPS-05 groundwork): for an uptime monitor. 200 when a worker has checked in within 5 minutes and no email
 * has waited more than 30 minutes; 503 otherwise. The body says only ok or not, nothing about the queue.
 */
export const GET = withRoute("api.health.worker", async () => {
  await connection(); // read the database at request time, never at build time
  const { ok } = await workerHealth();
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
