"use client";

import { DISTRICTS } from "@/lib/districts";
import { addAddressAction, deleteAddressAction } from "@/lib/server/actions/account";
import { ActionForm, FormInput, FormSelect } from "../forms/action-form";

export function AddAddressForm() {
  return (
    <ActionForm action={addAddressAction} submitLabel="Save address" resetOnSuccess>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Label" name="label" helper="For example Home or Office" required maxLength={30} />
        <FormInput label="Recipient name" name="recipientName" autoComplete="name" required maxLength={80} />
      </div>
      <FormInput label="Address line 1" name="line1" autoComplete="address-line1" required maxLength={120} />
      <FormInput label="Address line 2" name="line2" autoComplete="address-line2" helper="Optional" maxLength={120} />
      <div className="grid gap-5 sm:grid-cols-3">
        <FormInput label="City" name="city" autoComplete="address-level2" required maxLength={60} />
        <FormSelect label="District" name="district" options={DISTRICTS} placeholder="Choose" required />
        <FormInput
          label="Postal code"
          name="postalCode"
          autoComplete="postal-code"
          inputMode="numeric"
          helper="Optional"
          maxLength={10}
        />
      </div>
      <FormInput
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        helper="For the courier, e.g. 0771234567"
      />
    </ActionForm>
  );
}

export function DeleteAddressForm({ addressId, label }: { addressId: string; label: string }) {
  return (
    <ActionForm
      action={deleteAddressAction}
      submitLabel={`Delete ${label}`}
      pendingLabel="Deleting…"
      submitVariant="secondary"
      className="[&_button]:h-10 [&_button]:px-4 [&_button]:text-sm"
    >
      <input type="hidden" name="addressId" value={addressId} />
    </ActionForm>
  );
}
