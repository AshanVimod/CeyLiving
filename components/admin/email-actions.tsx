"use client";

import { retryEmailAction } from "@/lib/server/actions/admin";
import { ConfirmAction } from "./confirm-action";

/** B10: sends a stuck email again. Shown only when the service says it can be retried. */
export function RetryEmailButton({ deliveryId, label }: { deliveryId: string; label: string }) {
  return (
    <ConfirmAction
      action={retryEmailAction}
      label="Send again"
      title={`Send the “${label}” email again`}
      description="Check that the worker is running and the email settings are right first. The retry is recorded in the audit log."
      fields={{ deliveryId }}
      confirmLabel="Send again"
      tone="secondary"
    />
  );
}
