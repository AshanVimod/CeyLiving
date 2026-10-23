"use client";

import { markNotificationsReadAction } from "@/lib/server/actions/community";
import { ActionForm } from "../forms/action-form";

export function MarkAllReadButton() {
  return (
    <ActionForm
      action={async () => markNotificationsReadAction()}
      submitLabel="Mark all as read"
      pendingLabel="Updating…"
      submitVariant="secondary"
    />
  );
}
