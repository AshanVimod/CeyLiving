import type { JobHandler } from "@/lib/server/observability/job";

/** image.process (backend plan 10.2): a stub until B09 adds uploads and image processing. */
export const imageProcess: JobHandler<"image.process"> = async (data, log) => {
  log.warn({ uploadId: data.uploadId }, "job.stub: image.process arrives in B09; nothing was processed");
  return { processed: false };
};
