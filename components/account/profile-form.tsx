"use client";

import { updateProfileAction } from "@/lib/server/actions/account";
import { ActionForm, FormInput } from "../forms/action-form";

export function ProfileForm({ name, phone }: { name: string; phone?: string }) {
  return (
    <ActionForm action={updateProfileAction} submitLabel="Save changes" pendingLabel="Saving…">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Name" name="name" autoComplete="name" defaultValue={name} required maxLength={80} />
        <FormInput
          label="Mobile number"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={phone ?? ""}
          helper="Optional. For example 0771234567"
        />
      </div>
    </ActionForm>
  );
}
