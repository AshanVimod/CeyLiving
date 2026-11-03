import { getSession } from "@/lib/session";
import { NotFoundError } from "@/lib/server/errors";
import { withRoute } from "@/lib/server/observability/route";
import { readApplicationPhoto } from "@/lib/server/services/uploads";

/**
 * B09: application photos are private. Only the applicant and admins can open them; everyone else (and anyone
 * signed out) gets the same 404, so nobody learns whether a photo exists (SEC-A5). Never cached by shared caches.
 */
export const GET = withRoute("uploads.private", async (request) => {
  const match = /^\/uploads\/private\/([^/]+)\/(400|800|1600)\.webp$/.exec(request.nextUrl.pathname);
  const session = await getSession();
  if (!match || !session) return notFound();
  try {
    const body = await readApplicationPhoto(session.user, match[1]!, Number(match[2]));
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
});

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
