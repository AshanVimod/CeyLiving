"use client";

import { TEXT_LIMITS } from "@/lib/config";
import { moderateAction, officialReplyAction } from "@/lib/server/actions/admin";
import type { ContentStatus } from "@/lib/types";
import { FormTextArea } from "../forms/action-form";
import { ConfirmAction } from "./confirm-action";

type ContentType = "REVIEW" | "QUESTION" | "ANSWER";

/** RULE-M1 / RULE-M2: hide, restore, delete (with reasons) or reply as CeyLiving. Admins never edit the text. */
export function ModerationActions({
  targetType,
  targetId,
  status,
}: {
  targetType: ContentType;
  targetId: string;
  status: ContentStatus;
}) {
  const fields = { targetType, targetId };
  return (
    <div className="flex flex-wrap gap-2">
      {status === "VISIBLE" ? (
        <ConfirmAction
          action={moderateAction}
          label="Hide"
          title="Hide this post?"
          description="It stays in the database but disappears from public view. The author sees “hidden by moderator”. Open reports on it are resolved."
          fields={{ ...fields, action: "hide" }}
          reason={{ label: "Reason" }}
          confirmLabel="Hide post"
          tone="secondary"
        />
      ) : null}
      {status === "HIDDEN" ? (
        <ConfirmAction
          action={moderateAction}
          label="Restore"
          title="Restore this post?"
          description="It becomes visible to everyone again."
          fields={{ ...fields, action: "restore" }}
          confirmLabel="Restore post"
        />
      ) : null}
      {status !== "DELETED" ? (
        <ConfirmAction
          action={moderateAction}
          label="Delete"
          title="Delete this post permanently?"
          description="Only for illegal content or personal data. The text is erased; a record stays in the audit log."
          fields={{ ...fields, action: "delete" }}
          reason={{ label: "Reason" }}
          confirmLabel="Delete permanently"
          tone="danger"
        />
      ) : null}
      {targetType !== "ANSWER" && status === "VISIBLE" ? (
        <ConfirmAction
          action={officialReplyAction}
          label="Reply as CeyLiving"
          title="Reply as the CeyLiving team"
          description="Your reply is shown publicly and marked “CeyLiving team”."
          fields={fields}
          extra={<FormTextArea label="Reply" name="body" required maxLength={TEXT_LIMITS.answerMax} />}
          confirmLabel="Post reply"
          tone="secondary"
        />
      ) : null}
    </div>
  );
}
