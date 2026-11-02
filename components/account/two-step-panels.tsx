"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Field } from "@/components/forms/fields";
import { ActionForm, FormInput } from "@/components/forms/action-form";
import { PasskeySignIn } from "@/components/forms/auth-forms";
import type { ActionState } from "@/lib/action-result";
import { authClient } from "@/lib/auth-client";
import { formatDate } from "@/lib/format";
import {
  confirmAppSetupAction,
  newRecoveryCodesAction,
  removePasskeyAction,
  startAppSetupAction,
  turnOffAppAction,
} from "@/lib/server/actions/two-step";
import type { PasskeySummary } from "@/lib/server/repositories/people";
import { useHydrated } from "@/lib/use-hydrated";

// B05b (AU-02): setting up two-step sign-in. The server does every check (password, codes, who owns a passkey);
// these components only show the steps.

const button =
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold transition-colors disabled:opacity-60";
const primary = `${button} bg-forest text-paper hover:bg-forest-deep`;
const secondary = `${button} border border-ink/25 hover:border-ink`;

function Problem({ state }: { state: ActionState }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer">
      {state.message}
    </p>
  );
}

const fieldError = (state: ActionState, name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined);

/** Recovery codes, shown once right after they are made. Only their hashes are kept, so they can't be shown again. */
export function RecoveryCodes({ codes, continueHref }: { codes: string[]; continueHref?: string }) {
  const [saved, setSaved] = useState(false);
  function download() {
    const text = `CeyLiving recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "ceyliving-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  }
  return (
    <div className="space-y-4" role="status">
      <p className="rounded-md bg-sage px-4 py-3 text-sm">
        Save these recovery codes now. If you lose your phone, each one signs you in once. We can’t show them again.
      </p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-[0.95rem] tabular-nums" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code} className="rounded border border-line bg-paper px-3 py-2">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={download} className={secondary}>
          {saved ? "Downloaded" : "Download as a text file"}
        </button>
        {continueHref ? (
          // A full page load, so every part of the page sees the new session.
          <a href={continueHref} className={primary}>
            I’ve saved them, continue
          </a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The authenticator app card: set-up while it is off, otherwise its status and settings. Confirming the first code
 * changes the session cookie, so the page is drawn again from the server, now saying the app is on. Once set-up has
 * started it stays on screen anyway, so the one-time recovery codes are shown instead of being swapped away.
 */
export function AuthenticatorApp({
  enabled,
  recoveryCodesLeft,
  hasPassword,
  canMakeCodes,
  canTurnOff,
  continueHref,
}: {
  enabled: boolean;
  recoveryCodesLeft: number;
  hasPassword: boolean;
  canMakeCodes: boolean;
  canTurnOff: boolean;
  continueHref: string;
}) {
  const [settingUp, setSettingUp] = useState(false);
  if (!enabled || settingUp) {
    return <AppSetup hasPassword={hasPassword} continueHref={continueHref} onStarted={() => setSettingUp(true)} />;
  }
  return (
    <div className="space-y-6">
      <p>
        <span className="font-medium text-forest">On.</span>{" "}
        <span className="text-ink-soft">
          {recoveryCodesLeft} of 10 recovery codes left. Making new ones replaces them all.
        </span>
      </p>
      {canMakeCodes ? <NewRecoveryCodes hasPassword={hasPassword} /> : null}
      {canTurnOff ? <TurnOffApp hasPassword={hasPassword} /> : null}
    </div>
  );
}

/** Step 1: password (when the account has one), then the QR code and key; step 2: the first code from the app. */
function AppSetup({
  hasPassword,
  continueHref,
  onStarted,
}: {
  hasPassword: boolean;
  continueHref: string;
  onStarted: () => void;
}) {
  // The codes from step 1 live in this page's memory: without JavaScript a submit would load a new page and lose
  // them, so the buttons wait until the page is ready.
  const hydrated = useHydrated();
  const [started, start, starting] = useActionState(startAppSetupAction, null);
  const [confirmed, confirm, confirming] = useActionState(confirmAppSetupAction, null);
  const setup = started && "setup" in started ? started.setup : undefined;
  // From now on the parent keeps showing set-up, whatever the server says (see AuthenticatorApp).
  useEffect(() => {
    if (setup) onStarted();
  }, [setup, onStarted]);

  if (setup && confirmed?.ok) {
    return (
      <div className="space-y-4">
        <p className="font-medium">{confirmed.message}</p>
        <RecoveryCodes codes={setup.recoveryCodes} continueHref={continueHref} />
      </div>
    );
  }

  if (!setup) {
    return (
      <form action={start} className="max-w-md space-y-4">
        <p className="text-sm text-ink-soft">
          Use an app such as Google Authenticator, Microsoft Authenticator or 1Password. It shows a new 6-digit code
          every 30 seconds.
        </p>
        <Problem state={started} />
        {hasPassword ? (
          <Field
            label="Your password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            error={fieldError(started, "password")}
          />
        ) : null}
        <button type="submit" disabled={!hydrated || starting} className={primary}>
          {starting ? "Getting your code…" : "Set up an authenticator app"}
        </button>
      </form>
    );
  }

  return (
    <div className="max-w-md space-y-5">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>In your authenticator app, add an account and scan this QR code.</li>
        <li>Then enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made on the server; nothing to optimise */}
      <img src={setup.qrCode} alt="QR code for your authenticator app" width={200} height={200} className="bg-white" />
      <div>
        <p className="text-sm text-ink-soft">Can’t scan it? Type this key into the app instead:</p>
        <p className="mt-1 font-mono text-base tracking-wide break-all select-all">{setup.key}</p>
      </div>
      <form action={confirm} className="space-y-4">
        <Problem state={confirmed} />
        <Field
          label="Code from your app"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          error={fieldError(confirmed, "code")}
        />
        <button type="submit" disabled={!hydrated || confirming} className={primary}>
          {confirming ? "Checking…" : "Turn on two-step sign-in"}
        </button>
      </form>
    </div>
  );
}

/** New recovery codes replace the old ones; shown once. */
export function NewRecoveryCodes({ hasPassword }: { hasPassword: boolean }) {
  const hydrated = useHydrated(); // the new codes are shown from this page's memory (see AppSetup)
  const [state, run, pending] = useActionState(newRecoveryCodesAction, null);
  if (state && "recoveryCodes" in state && state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} />;
  return (
    <form action={run} className="max-w-md space-y-3">
      <Problem state={state} />
      {hasPassword ? (
        <Field
          label="Your password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={fieldError(state, "password")}
        />
      ) : null}
      <button type="submit" disabled={!hydrated || pending} className={secondary}>
        {pending ? "Making new codes…" : "Make new recovery codes"}
      </button>
    </form>
  );
}

/** Customers only (the server refuses sellers and admins). */
export function TurnOffApp({ hasPassword }: { hasPassword: boolean }) {
  return (
    <ActionForm
      action={turnOffAppAction}
      submitLabel="Turn off the authenticator app"
      pendingLabel="Turning off…"
      submitVariant="secondary"
      className="max-w-md"
    >
      {hasPassword ? (
        <FormInput label="Your password" name="password" type="password" autoComplete="current-password" required />
      ) : null}
    </ActionForm>
  );
}

/**
 * AU-02: the person's passkeys, with "Add a passkey" (WebAuthn in the browser) and "Remove". When this session
 * still needs two steps, it offers to sign in with the new passkey, which opens the seller or admin area.
 */
export function Passkeys({
  passkeys,
  signInNext,
}: {
  passkeys: PasskeySummary[];
  /** Set when this session isn't two-step yet: where signing in with a passkey should lead. */
  signInNext?: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();

  async function add() {
    setBusy(true);
    setNote(undefined);
    const { error } = await authClient.passkey.addPasskey({ name: name.trim().slice(0, 60) || undefined });
    setBusy(false);
    if (error) {
      const cancelled = "code" in error && error.code === "REGISTRATION_CANCELLED";
      if (!cancelled) setNote({ ok: false, text: error.message || "The passkey couldn’t be added. Try again." });
      return;
    }
    setName("");
    setNote({ ok: true, text: "Passkey added. You’ve been signed out on your other devices." });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {passkeys.length ? (
        <ul className="divide-y divide-line rounded-md border border-line">
          {passkeys.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="block font-medium">{p.name ?? "Passkey"}</span>
                {p.createdAt ? (
                  <span className="block text-sm text-ink-soft">Added {formatDate(p.createdAt)}</span>
                ) : null}
              </span>
              <ActionForm
                action={removePasskeyAction}
                submitLabel="Remove"
                pendingLabel="Removing…"
                submitVariant="secondary"
                className="[&_p]:max-w-xs"
              >
                <input type="hidden" name="passkeyId" value={p.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No passkeys yet.</p>
      )}
      {note ? (
        <p
          role={note.ok ? "status" : "alert"}
          className={`rounded-md px-4 py-3 text-sm ${note.ok ? "bg-sage" : "bg-lacquer/10 text-lacquer"}`}
        >
          {note.text}
        </p>
      ) : null}
      <div className="flex max-w-md flex-wrap items-end gap-3">
        <Field
          label="Name (optional)"
          name="passkeyName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="For example: My phone"
          maxLength={60}
          className="min-w-48 flex-1"
        />
        <button type="button" onClick={add} disabled={!hydrated || busy} className={`${primary} h-12`}>
          {busy ? "Follow your device’s steps…" : "Add a passkey"}
        </button>
      </div>
      {signInNext && passkeys.length ? (
        <div className="max-w-md">
          <PasskeySignIn next={signInNext} label="Continue: sign in with your passkey" />
        </div>
      ) : null}
    </div>
  );
}
