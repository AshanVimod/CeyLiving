"use client";

import { refundAction, releaseHoldAction, resolveRefundAction } from "@/lib/server/actions/payments";
import { FormInput, FormSelect } from "../forms/action-form";
import { ConfirmAction } from "./confirm-action";

// B08 (PAY-05 to PAY-07): admin refund and hold buttons. Each goes through a confirmation with a reason, which the
// audit log keeps. The amount is shown, never sent: the server works it out (BR-18).

const METHODS = [
  { value: "PAYHERE", label: "Through PayHere (back to the card or wallet)" },
  { value: "MANUAL", label: "Bank transfer done by hand (enter its reference)" },
];

export function RefundButton({
  target,
  title,
  amount,
  payHereAvailable,
}: {
  target: { sellerOrderId: string } | { paymentId: string };
  title: string;
  amount: string;
  payHereAvailable: boolean;
}) {
  return (
    <ConfirmAction
      action={refundAction}
      label="Refund"
      title={title}
      description={`Gives back ${amount} to the customer. The customer and the maker are told, and it is recorded in the audit log.`}
      fields={target as Record<string, string>}
      reason={{ label: "Reason" }}
      extra={
        <>
          <FormSelect
            label="How"
            name="method"
            options={payHereAvailable ? METHODS : METHODS.slice(1)}
            defaultValue={payHereAvailable ? "PAYHERE" : "MANUAL"}
          />
          <FormInput label="Bank reference (manual refunds)" name="reference" maxLength={60} />
        </>
      }
      confirmLabel={`Refund ${amount}`}
      tone="danger"
    />
  );
}

export function ResolveRefundButton({ refundId }: { refundId: string }) {
  return (
    <ConfirmAction
      action={resolveRefundAction}
      label="Record outcome"
      title="What did PayHere do?"
      description="PayHere didn’t answer when this refund was sent. Check the payment in PayHere first, then record what you found."
      fields={{ refundId }}
      extra={
        <>
          <FormSelect
            label="Outcome"
            name="outcome"
            options={[
              { value: "succeeded", label: "PayHere refunded it" },
              { value: "failed", label: "No refund in PayHere (it can be sent again)" },
            ]}
          />
          <FormInput label="PayHere refund number (if refunded)" name="reference" maxLength={60} />
          <FormInput label="Note (if not refunded)" name="note" maxLength={300} />
        </>
      }
      confirmLabel="Record"
      tone="secondary"
    />
  );
}

export function ReleaseHoldButton({ shopId, shopName }: { shopId: string; shopName: string }) {
  return (
    <ConfirmAction
      action={releaseHoldAction}
      label="Release payouts"
      title={`Release ${shopName}’s payouts`}
      description="Only after reviewing the chargeback. Payouts for this shop are made again from the next run."
      fields={{ shopId }}
      reason={{ label: "What you found" }}
      confirmLabel="Release"
      tone="secondary"
    />
  );
}
