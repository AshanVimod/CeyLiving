import type { JobHandler } from "@/lib/server/observability/job";
import type { JobName } from "@/lib/server/jobs/queues";
import { customRequestsExpire } from "./custom-requests-expire";
import { emailSend } from "./email-send";
import { imageProcess } from "./image-process";
import { maintenanceCleanup } from "./maintenance-cleanup";
import { ordersAutoCancelUnaccepted } from "./orders-auto-cancel-unaccepted";
import { ordersAutoComplete } from "./orders-auto-complete";
import { ordersExpireUnpaid } from "./orders-expire-unpaid";
import { paymentsReconcile } from "./payments-reconcile";
import { payoutsGenerateWeekly } from "./payouts-generate-weekly";
import { reportsAutoHide } from "./reports-auto-hide";
import { usersLiftExpiredMutes } from "./users-lift-expired-mutes";

/** JOB-01: one handler per job in the catalogue (lib/server/jobs/queues.ts); the type makes a missing one an error. */
export const HANDLERS: { [N in JobName]: JobHandler<N> } = {
  "email.send": emailSend,
  "image.process": imageProcess,
  "orders.expireUnpaid": ordersExpireUnpaid,
  "orders.autoCancelUnaccepted": ordersAutoCancelUnaccepted,
  "orders.autoComplete": ordersAutoComplete,
  "payouts.generateWeekly": payoutsGenerateWeekly,
  "payments.reconcile": paymentsReconcile,
  "customRequests.expire": customRequestsExpire,
  "users.liftExpiredMutes": usersLiftExpiredMutes,
  "reports.autoHide": reportsAutoHide,
  "maintenance.cleanup": maintenanceCleanup,
};
