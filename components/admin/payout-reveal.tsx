"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { revealPayoutAccountAction } from "@/lib/server/actions/extras";
import type { RevealedPayoutAccount } from "@/lib/server/services/payout-accounts";
import { ActionForm, FormInput } from "../forms/action-form";
import { CloseIcon } from "../ui/icons";

const SHOWN_FOR_MS = 60_000;

/**
 * B11 (12.4): "reveal for payout". The details live only in this dialog's state: they are cleared when it closes or
 * after a minute, and the form never holds them (the action below passes it only the outcome).
 */
export function RevealPayoutAccount({ payoutId, shopName }: { payoutId: string; shopName: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [account, setAccount] = useState<RevealedPayoutAccount | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!account) return;
    const timer = setTimeout(() => ref.current?.close(), SHOWN_FOR_MS);
    return () => clearTimeout(timer);
  }, [account]);

  async function reveal(state: ActionState, form: FormData): Promise<ActionResult> {
    const result = await revealPayoutAccountAction(state, form);
    if (!result.ok) return result;
    if (result.account) setAccount(result.account);
    return { ok: true, message: "Shown for one minute. This view was logged." };
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="inline-flex h-11 items-center rounded-full border border-ink/25 px-5 text-sm font-semibold transition-colors hover:border-ink"
      >
        Show bank details
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => {
          setAccount(null);
          setCopied(false);
        }}
        className="m-auto w-[min(520px,calc(100vw-2rem))] rounded-lg border border-line bg-paper p-0 text-ink shadow-[0_30px_80px_-30px_rgb(19_36_28/0.6)] backdrop:bg-ink/45"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id={titleId} className="text-2xl">
            Bank details for {shopName}
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
          {account ? (
            <dl className="grid gap-3">
              <div>
                <dt className="text-sm text-ink-soft">Account holder</dt>
                <dd className="font-semibold">{account.accountName}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">Bank and branch</dt>
                <dd className="font-semibold">
                  {account.bankName}, {account.branch}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-soft">Account number</dt>
                <dd className="flex items-center gap-3 text-xl font-semibold tabular-nums">
                  {account.accountNumber}
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(account.accountNumber).then(() => setCopied(true));
                    }}
                    className="inline-flex h-9 items-center rounded-full border border-ink/25 px-4 text-sm font-semibold hover:border-ink"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>
              <p className="mt-2 text-sm text-ink-soft">Closes after one minute. This view is in the audit log.</p>
            </dl>
          ) : (
            <>
              <p className="mb-5 text-ink-soft">
                Enter your password to see the full account number. Each view is logged under your name.
              </p>
              <ActionForm action={reveal} submitLabel="Show bank details" pendingLabel="Checking…" resetOnSuccess>
                <input type="hidden" name="payoutId" value={payoutId} />
                <FormInput
                  label="Your password"
                  name="password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                />
              </ActionForm>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
