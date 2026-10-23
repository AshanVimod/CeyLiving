import { getSession } from "@/lib/session";
import { exportMyData } from "@/lib/server/services/privacy";

/**
 * FR-17 / SEC-12: download everything we hold about the signed-in person as JSON.
 * Only ever the requester's own data; never cached.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Sign in to download your data.", { status: 401 });
  const body = JSON.stringify(exportMyData(session.user), null, 2);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ceyliving-my-data-${date}.json"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
