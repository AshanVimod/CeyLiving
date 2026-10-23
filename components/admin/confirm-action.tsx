"use client";

import { useId, useRef } from "react";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { TEXT_LIMITS } from "@/lib/config";
import { ActionForm, FormTextArea } from "../forms/action-form";
import { CloseIcon } from "../ui/icons";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionResult>;

interface ConfirmActionProps {
  action: ServerAction;
  /** Button that opens the dialog. */
  label: string;
  title: string;
  description: string;
  fields: Record<string, string>;
  /** Shows a required reason box (RULE-A2, RULE-M1, SEC-A9). */
  reason?: { label: string; helper?: string };
  confirmLabel: string;
  tone?: "primary" | "danger" | "secondary";
  extra?: React.ReactNode;
}

const triggerTone = {
  primary: "bg-forest text-paper hover:bg-forest-deep",
  danger: "border border-lacquer/60 text-lacquer hover:bg-lacquer hover:text-paper",
  secondary: "border border-ink/25 hover:border-ink",
};

/** Admin decisions always pass through a confirmation dialog (feature spec 11.1). */
export function ConfirmAction(props: ConfirmActionProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const tone = props.tone ?? "primary";
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={`inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold transition-colors ${triggerTone[tone]}`}
      >
        {props.label}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-lg border border-line bg-paper p-0 text-ink shadow-[0_30px_80px_-30px_rgb(19_36_28/0.6)] backdrop:bg-ink/45"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-2xl">
            {props.title}
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-mr-2 grid size-11 place-items-center rounded-full hover:bg-sage"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="px-6 py-5">
          <p className="mb-5 text-ink-soft">{props.description}</p>
          <ActionForm
            action={props.action}
            submitLabel={props.confirmLabel}
            pendingLabel="Working…"
            submitVariant={tone === "danger" ? "danger" : "primary"}
            extraButtons={
              <button
                type="button"
                onClick={() => ref.current?.close()}
                className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink"
              >
                Cancel
              </button>
            }
          >
            {Object.entries(props.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            {props.extra}
            {props.reason ? (
              <FormTextArea
                label={props.reason.label}
                name="reason"
                required
                maxLength={TEXT_LIMITS.reasonMax}
                helper={
                  props.reason.helper ??
                  `${TEXT_LIMITS.reasonMin}–${TEXT_LIMITS.reasonMax} characters. Recorded in the audit log.`
                }
              />
            ) : null}
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}
