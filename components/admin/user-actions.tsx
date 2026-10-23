"use client";

import { MUTE_DAY_OPTIONS } from "@/lib/config";
import { resolveReportAction, restrictUserAction } from "@/lib/server/actions/admin";
import type { PostingRestriction } from "@/lib/types";
import { ConfirmAction } from "./confirm-action";

/** RULE-M3 / RULE-M5: mute for 7 or 30 days, ban, or lift. Never shown for admins. */
export function UserRestrictionActions({ userId, name, restriction }: { userId: string; name: string; restriction: PostingRestriction }) {
  return (
    <div className="flex flex-wrap gap-2">
      {restriction !== "NONE" ? (
        <ConfirmAction
          action={restrictUserAction}
          label="Lift restriction"
          title={`Let ${name} post again?`}
          description="They can post reviews and questions straight away."
          fields={{ userId, action: "lift" }}
          reason={{ label: "Reason" }}
          confirmLabel="Lift restriction"
        />
      ) : null}
      {MUTE_DAY_OPTIONS.map((days) => (
        <ConfirmAction
          key={days}
          action={restrictUserAction}
          label={`Mute ${days} days`}
          title={`Mute ${name} for ${days} days?`}
          description="They can’t post reviews or questions until then. They can still buy and see their own data."
          fields={{ userId, action: "mute", days: String(days) }}
          reason={{ label: "Reason (shown to the user)" }}
          confirmLabel={`Mute for ${days} days`}
          tone="secondary"
        />
      ))}
      {restriction !== "BANNED" ? (
        <ConfirmAction
          action={restrictUserAction}
          label="Ban from posting"
          title={`Ban ${name} from posting?`}
          description="They can’t post reviews or questions until an admin lifts the ban. Buying still works."
          fields={{ userId, action: "ban" }}
          reason={{ label: "Reason (shown to the user)" }}
          confirmLabel="Ban from posting"
          tone="danger"
        />
      ) : null}
    </div>
  );
}

export function ReportResolution({ reportId }: { reportId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmAction
        action={resolveReportAction}
        label="Resolve"
        title="Mark this report resolved?"
        description="Use after you’ve acted on the content (for example, hidden it or removed the item)."
        fields={{ reportId, status: "RESOLVED" }}
        reason={{ label: "What was done" }}
        confirmLabel="Resolve"
        tone="secondary"
      />
      <ConfirmAction
        action={resolveReportAction}
        label="Dismiss"
        title="Dismiss this report?"
        description="Nothing breaks the rules. The content stays as it is."
        fields={{ reportId, status: "DISMISSED" }}
        reason={{ label: "Why it’s fine" }}
        confirmLabel="Dismiss"
        tone="secondary"
      />
    </div>
  );
}
