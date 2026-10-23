"use client";

import { confirmDeliveryAction } from "@/lib/server/actions/community";
import { ActionForm } from "../forms/action-form";

/** BR-17: the customer confirms delivery, which unlocks reviews. */
export function ConfirmDeliveryForm({ sellerOrderId }: { sellerOrderId: string }) {
  return (
    <ActionForm action={confirmDeliveryAction} submitLabel="I received this" pendingLabel="Confirming…">
      <input type="hidden" name="sellerOrderId" value={sellerOrderId} />
    </ActionForm>
  );
}
