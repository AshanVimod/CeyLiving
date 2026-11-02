import type { JobHandler } from "@/lib/server/observability/job";
import { autoHideReportedContent } from "@/lib/server/services/moderation";

/** reports.autoHide (RULE-M4), enqueued by reportContent in the report's own transaction. */
export const reportsAutoHide: JobHandler<"reports.autoHide"> = async (data) => ({
  targetType: data.targetType,
  hidden: await autoHideReportedContent(data.targetType, data.targetId),
});
