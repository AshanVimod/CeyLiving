"use client";

import { decideProductAction } from "@/lib/server/actions/admin";
import type { ProductStatus } from "@/lib/types";
import { ConfirmAction } from "./confirm-action";

/** FR-9: approve or reject items waiting for review; remove rule-breaking items at any stage. */
export function ProductDecisions({ productId, title, status }: { productId: string; title: string; status: ProductStatus }) {
  return (
    <div className="flex flex-wrap gap-2">
      {status === "PENDING_REVIEW" ? (
        <>
          <ConfirmAction
            action={decideProductAction}
            label="Approve"
            title={`Approve “${title}”?`}
            description="It goes on sale straight away and the seller is told."
            fields={{ productId, decision: "approve" }}
            confirmLabel="Approve"
          />
          <ConfirmAction
            action={decideProductAction}
            label="Reject"
            title={`Reject “${title}”?`}
            description="The seller sees your reason and can edit and resubmit."
            fields={{ productId, decision: "reject" }}
            reason={{ label: "What needs to change (shown to the seller)" }}
            confirmLabel="Reject"
            tone="secondary"
          />
        </>
      ) : null}
      {status !== "REMOVED" ? (
        <ConfirmAction
          action={decideProductAction}
          label="Remove"
          title={`Remove “${title}”?`}
          description="For items that break the rules (spec BR-20). The seller can’t restore a removed item."
          fields={{ productId, decision: "remove" }}
          reason={{ label: "Rule broken" }}
          confirmLabel="Remove item"
          tone="danger"
        />
      ) : null}
    </div>
  );
}
