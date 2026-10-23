"use client";

import { transitionOrderAction } from "@/lib/server/actions/selling";
import type { SellerOrderStatus } from "@/lib/types";
import { ConfirmAction } from "../admin/confirm-action";
import { ActionForm, FormInput } from "../forms/action-form";

/** Spec BR-07: only the moves the status machine allows from the current status are offered. */
export function SellerOrderActions({ sellerOrderId, status }: { sellerOrderId: string; status: SellerOrderStatus }) {
  const canCancel = status === "NEW" || status === "ACCEPTED" || status === "IN_PROGRESS";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {status === "NEW" ? (
          <ActionForm action={transitionOrderAction} submitLabel="Accept order" pendingLabel="Accepting…">
            <input type="hidden" name="sellerOrderId" value={sellerOrderId} />
            <input type="hidden" name="to" value="ACCEPTED" />
          </ActionForm>
        ) : null}
        {status === "ACCEPTED" ? (
          <ActionForm action={transitionOrderAction} submitLabel="Start making" submitVariant="secondary">
            <input type="hidden" name="sellerOrderId" value={sellerOrderId} />
            <input type="hidden" name="to" value="IN_PROGRESS" />
          </ActionForm>
        ) : null}
        {canCancel ? (
          <ConfirmAction
            action={transitionOrderAction}
            label="Cancel order"
            title="Cancel this order?"
            description="The customer is refunded and told your reason. Stock is released."
            fields={{ sellerOrderId, to: "CANCELLED" }}
            reason={{ label: "Reason (shown to the customer)" }}
            confirmLabel="Cancel order"
            tone="danger"
          />
        ) : null}
      </div>
      {status === "ACCEPTED" || status === "IN_PROGRESS" ? (
        <section aria-labelledby={`dispatch-${sellerOrderId}`} className="rounded-md border border-line p-4">
          <h3 id={`dispatch-${sellerOrderId}`} className="mb-3 font-sans text-base font-semibold">
            Mark as dispatched
          </h3>
          <ActionForm action={transitionOrderAction} submitLabel="Mark dispatched" pendingLabel="Saving…">
            <input type="hidden" name="sellerOrderId" value={sellerOrderId} />
            <input type="hidden" name="to" value="DISPATCHED" />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormInput
                label="Courier"
                name="courierName"
                required
                maxLength={60}
                helper="For example Pronto Lanka or Domex"
              />
              <FormInput label="Tracking number" name="trackingRef" maxLength={40} helper="Optional" />
            </div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
