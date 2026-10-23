import { getSession } from "@/lib/session";
import { withRoute } from "@/lib/server/observability/route";
import { exportMyData } from "@/lib/server/services/privacy";

/**
 * FR-17 / SEC-12: download everything we hold about the signed-in person as JSON.
 * Only ever the requester's own data; never cached. Logs the user ID only, never the export itself.
 */
export const GET = withRoute("account.export", async (_request, log) => {
  const session = await getSession();
  if (!session) return new Response("Sign in to download your data.", { status: 401 });
  log.info({ userId: session.user.id }, "account.export.started");
  const body = JSON.stringify(await exportMyData(session.user), null, 2);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ceyliving-my-data-${date}.json"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
