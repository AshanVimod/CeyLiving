import type { JobHandler } from "@/lib/server/observability/job";
import { processUpload } from "@/lib/server/services/image-processing";

/** image.process (backend plan 10.2, SEC-07), queued when an upload is confirmed (B09). */
export const imageProcess: JobHandler<"image.process"> = async (data) => ({
  uploadId: data.uploadId,
  ...(await processUpload(data.uploadId)),
});
