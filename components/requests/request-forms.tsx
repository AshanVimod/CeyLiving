"use client";

import {
  createCustomRequestAction,
  declineRequestAction,
  quoteRequestAction,
  respondToQuoteAction,
} from "@/lib/server/actions/extras";
import { ConfirmAction } from "../admin/confirm-action";
import { ActionForm, FormInput, FormSelect, FormTextArea } from "../forms/action-form";

/** FR-14: ask a maker for something made to order. No contact details (RULE-Q4); replies arrive in the account. */
export function CustomRequestForm({
  shops,
  defaultShopId,
}: {
  shops: { value: string; label: string }[];
  defaultShopId?: string;
}) {
  return (
    <ActionForm action={createCustomRequestAction} submitLabel="Send request" pendingLabel="Sending…" resetOnSuccess>
      <FormSelect
        label="Maker"
        name="shopId"
        options={shops}
        placeholder="Choose a maker"
        required
        defaultValue={defaultShopId ?? ""}
      />
      <FormTextArea
        label="What would you like made?"
        name="message"
        required
        maxLength={1000}
        helper="20 to 1,000 characters. Sizes, colours, names or dates, and when you need it. No phone numbers, emails or links."
      />
      <FormInput label="Budget (LKR)" name="budget" inputMode="decimal" helper="Optional" />
    </ActionForm>
  );
}

export function QuoteForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={quoteRequestAction} submitLabel="Send quote" pendingLabel="Sending…">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormInput label="Price (LKR)" name="price" inputMode="decimal" required />
        <FormInput label="Days to make" name="days" inputMode="numeric" required />
      </div>
      <FormTextArea
        label="Message (optional)"
        name="message"
        maxLength={500}
        helper="What’s included, materials, anything you need from them."
      />
    </ActionForm>
  );
}

export function DeclineRequestButton({ requestId }: { requestId: string }) {
  return (
    <ConfirmAction
      action={declineRequestAction}
      label="Decline"
      title="Decline this request?"
      description="The customer is told your reason. Be kind; they may come back for something else."
      fields={{ requestId }}
      reason={{ label: "Reason (shown to the customer)", helper: "5–300 characters." }}
      confirmLabel="Decline request"
      tone="secondary"
    />
  );
}

export function QuoteResponse({ requestId }: { requestId: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <ActionForm action={respondToQuoteAction} submitLabel="Accept quote" pendingLabel="Accepting…">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="response" value="accept" />
      </ActionForm>
      <ActionForm
        action={respondToQuoteAction}
        submitLabel="Decline"
        submitVariant="secondary"
        pendingLabel="Declining…"
      >
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="response" value="decline" />
      </ActionForm>
    </div>
  );
}
