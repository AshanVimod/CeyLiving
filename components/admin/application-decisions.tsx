"use client";

import { decideApplicationAction } from "@/lib/server/actions/admin";
import { ConfirmAction } from "./confirm-action";

/** RULE-A2: approve, or reject / request changes with a reason the applicant will see. */
export function ApplicationDecisions({ applicationId, shopName }: { applicationId: string; shopName: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <ConfirmAction
        action={decideApplicationAction}
        label="Approve"
        title={`Approve ${shopName}?`}
        description="The applicant becomes a seller and gets a draft shop to set up. This is recorded in the audit log."
        fields={{ applicationId, decision: "approve" }}
        confirmLabel="Approve and create shop"
      />
      <ConfirmAction
        action={decideApplicationAction}
        label="Request changes"
        title="Request changes"
        description="The applicant sees your message and can update the application."
        fields={{ applicationId, decision: "changes" }}
        reason={{ label: "Message to the applicant" }}
        confirmLabel="Send request"
        tone="secondary"
      />
      <ConfirmAction
        action={decideApplicationAction}
        label="Reject"
        title={`Reject ${shopName}?`}
        description="The applicant sees your reason and can apply again after 30 days."
        fields={{ applicationId, decision: "reject" }}
        reason={{ label: "Reason (shown to the applicant)" }}
        confirmLabel="Reject application"
        tone="danger"
      />
    </div>
  );
}
