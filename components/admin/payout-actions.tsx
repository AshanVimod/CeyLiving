"use client";

import { generatePayoutsAction, markPayoutPaidAction } from "@/lib/server/actions/extras";
import { ActionForm, FormInput } from "../forms/action-form";
import { ConfirmAction } from "./confirm-action";

/** Runs the weekly payout job by hand until a background worker exists (BR-11). */
export function GeneratePayoutsButton() {
  return <ActionForm action={async () => generatePayoutsAction()} submitLabel="Create this week’s statements" pendingLabel="Creating…" />;
}

export function MarkPaidButton({ payoutId, shopName }: { payoutId: string; shopName: string }) {
  return (
    <ConfirmAction
      action={markPayoutPaidAction}
      label="Mark paid"
      title={`Record the transfer to ${shopName}`}
      description="Only after the bank transfer has gone through. The seller is told, and the reference is kept in the audit log."
      fields={{ payoutId }}
      extra={<FormInput label="Bank reference" name="reference" required maxLength={40} />}
      confirmLabel="Mark as paid"
      tone="secondary"
    />
  );
}
