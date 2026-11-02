import type { JobHandler } from "@/lib/server/observability/job";

/** email.send (backend plan 10.2): a stub until B10 moves email to the worker. Sign-in emails still go out directly. */
export const emailSend: JobHandler<"email.send"> = async (data, log) => {
  log.warn({ template: data.template }, "job.stub: email.send arrives in B10; nothing was sent");
  return { sent: false };
};
