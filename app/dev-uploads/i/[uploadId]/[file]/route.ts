import { getEnv } from "@/lib/env";
import { withRoute } from "@/lib/server/observability/route";
import { isLocalDriverOn, readLocalPublic } from "@/lib/server/storage/local";

/**
 * B09, development only (STORAGE_DRIVER=local): serves processed product and shop photos from .data/uploads/public,
 * standing in for the image domain (NEXT_PUBLIC_IMAGE_BASE_URL=/dev-uploads). Elsewhere a plain 404.
 */
export const GET = withRoute("dev-uploads", async (request) => {
  const env = getEnv();
  if (!isLocalDriverOn(env)) return new Response(null, { status: 404 });
  const key = request.nextUrl.pathname.replace(/^\/dev-uploads\//, "");
  const body = await readLocalPublic(env, key);
  if (!body) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
