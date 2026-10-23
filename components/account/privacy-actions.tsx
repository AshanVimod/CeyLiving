"use client";

import { changeRoleAction, deleteAccountAction } from "@/lib/server/actions/extras";
import { ConfirmAction } from "../admin/confirm-action";
import { FormInput } from "../forms/action-form";

/** FR-17: deleting needs the word DELETE typed in a confirmation dialog. */
export function DeleteAccountButton() {
  return (
    <ConfirmAction
      action={deleteAccountAction}
      label="Delete my account"
      title="Delete your account?"
      description="Your name, email, phone, addresses and notifications are removed and you’re signed out. Order records stay for legal reasons, and your reviews and questions show “Former customer”. This can’t be undone."
      fields={{}}
      extra={<FormInput label="Type DELETE to confirm" name="confirm" required autoComplete="off" />}
      confirmLabel="Delete my account"
      tone="danger"
    />
  );
}

/** FR-16: promote a customer to admin, with a reason for the audit log. */
export function MakeAdminButton({ userId, name }: { userId: string; name: string }) {
  return (
    <ConfirmAction
      action={changeRoleAction}
      label="Make admin"
      title={`Give ${name} admin access?`}
      description="Admins can approve shops, moderate content and restrict users. This can’t be undone from the admin panel, because admins can’t change another admin’s role."
      fields={{ userId, role: "ADMIN" }}
      reason={{ label: "Reason" }}
      confirmLabel="Make admin"
      tone="secondary"
    />
  );
}
