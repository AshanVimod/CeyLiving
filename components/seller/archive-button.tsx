"use client";

import { archiveProductAction } from "@/lib/server/actions/selling";
import { ActionForm } from "../forms/action-form";

export function ArchiveButton({ productId, restore = false, title }: { productId: string; restore?: boolean; title: string }) {
  return (
    <ActionForm
      action={archiveProductAction}
      submitLabel={restore ? "Move to drafts" : "Archive"}
      pendingLabel="Working…"
      submitVariant="secondary"
      className="[&>div>button]:h-10 [&>div>button]:px-4 [&>div>button]:text-sm"
    >
      <input type="hidden" name="productId" value={productId} />
      {restore ? <input type="hidden" name="restore" value="1" /> : null}
      <span className="sr-only">{restore ? `Move ${title} back to drafts` : `Archive ${title}`}</span>
    </ActionForm>
  );
}
