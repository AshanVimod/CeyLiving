import { getEnv } from "@/lib/env";
import { withRoute } from "@/lib/server/observability/route";
import { isLocalDriverOn, receiveLocalUpload } from "@/lib/server/storage/local";

/**
 * B09, development only (STORAGE_DRIVER=local): stands in for R2's presigned PUT. The browser sends the photo here
 * with the signed ticket from requestUploadAction; anything else gets 403. Elsewhere this route is a plain 404.
 */
export const PUT = withRoute(
  "api.uploads.local",
  async (request) => {
    const env = getEnv();
    if (!isLocalDriverOn(env)) return new Response(null, { status: 404 });
    const status = await receiveLocalUpload(env, request);
    return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  },
  { bodyLimit: "handler" },
); // 12.2: receiveLocalUpload enforces the ticket's own size limit while streaming
