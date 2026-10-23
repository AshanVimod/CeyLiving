"use client";

import { useId, useRef } from "react";
import { TEXT_LIMITS } from "@/lib/config";
import { reportAction } from "@/lib/server/actions/community";
import type { ReportTargetType } from "@/lib/types";
import { ActionForm, FormSelect, FormTextArea } from "../forms/action-form";
import { CloseIcon } from "../ui/icons";

const REASONS = [
  "Spam or advertising",
  "Offensive or abusive",
  "Contact details or off-site deal",
  "Counterfeit or copied design",
  "Prohibited item",
  "Something else",
];

/** FR-8: report an item, shop, review, question or answer to the CeyLiving team. */
export function ReportButton({ targetType, targetId, label }: { targetType: ReportTargetType; targetId: string; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="min-h-10 rounded-sm px-1 text-sm text-ink-soft underline underline-offset-4 hover:text-lacquer">
        Report<span className="sr-only"> {label}</span>
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(480px,calc(100vw-2rem))] rounded-lg border border-line bg-paper p-0 text-ink shadow-[0_30px_80px_-30px_rgb(19_36_28/0.6)] backdrop:bg-ink/45"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-2xl">
            Report {label}
          </h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="-mr-2 grid size-11 place-items-center rounded-full hover:bg-sage">
            <CloseIcon />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="mb-5 text-ink-soft">Our team reviews every report. The person you report isn’t told who reported them.</p>
          <ActionForm
            action={reportAction}
            submitLabel="Send report"
            pendingLabel="Sending…"
            extraButtons={
              <button type="button" onClick={() => ref.current?.close()} className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink">
                Cancel
              </button>
            }
          >
            <input type="hidden" name="targetType" value={targetType} />
            <input type="hidden" name="targetId" value={targetId} />
            <FormSelect label="Reason" name="reason" options={REASONS} placeholder="Choose" required />
            <FormTextArea label="Details (optional)" name="details" maxLength={TEXT_LIMITS.reportDetailsMax} />
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}
