"use client";

import { simulatePaymentAction } from "@/lib/server/actions/payments";
import { ActionForm } from "../forms/action-form";

/** Development only: answers for PayHere with a correctly signed notification (never rendered in production). */
export function SimulatePayment({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="rounded-lg border border-dashed border-turmeric p-5">
      <p className="mb-1 font-semibold">Development: simulate PayHere</p>
      <p className="mb-4 text-sm text-ink-soft">
        Sends a correctly signed notification through the same code as PayHere’s, then opens the result page.
      </p>
      <ActionForm
        action={simulatePaymentAction}
        submitLabel="Simulate payment"
        pendingLabel="Simulating…"
        submitName="outcome"
        submitValue="success"
        extraButtons={
          <>
            <button
              type="submit"
              name="outcome"
              value="failed"
              className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink"
            >
              Simulate failure
            </button>
            <button
              type="submit"
              name="outcome"
              value="cancelled"
              className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink"
            >
              Simulate cancel
            </button>
          </>
        }
      >
        <input type="hidden" name="orderNumber" value={orderNumber} />
      </ActionForm>
    </div>
  );
}
