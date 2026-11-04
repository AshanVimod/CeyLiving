import type { JobHandler } from "@/lib/server/observability/job";
import { watchEmails } from "@/lib/server/services/email";

/** email.watch (B10), every 15 minutes: tells the admins about failed and stuck emails, each once. */
export const emailWatch: JobHandler<"email.watch"> = async () => watchEmails();
