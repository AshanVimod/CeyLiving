"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  changePasswordAction,
  forgotPasswordAction,
  registerAction,
  resetPasswordAction,
  signInAction,
} from "@/lib/server/actions/auth";
import { verifyTwoStepAction } from "@/lib/server/actions/two-step";
import { useHydrated } from "@/lib/use-hydrated";
import { ActionForm, FormInput } from "./action-form";
import { TurnstileField } from "./turnstile";

// B05a and B05b: the real sign-in forms. Each posts to a server action (so nothing typed can reach the address bar), the
// server validates and checks everything (SEC-A1, SEC-A3), and messages never say whether an email has an account.

function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-[2.4rem]">{title}</h1>
      <div className="mt-8">{children}</div>
      <div className="mt-8 border-t border-line pt-6 text-ink-soft">{footer}</div>
    </div>
  );
}

const link = "font-semibold text-forest underline underline-offset-4";

/** AU-02: signs in with a passkey in the browser (WebAuthn), then goes on to `next`, a path the server checked. */
export function PasskeySignIn({ next, label = "Sign in with a passkey" }: { next: string; label?: string }) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  async function signIn() {
    setBusy(true);
    setProblem(undefined);
    const { error } = await authClient.signIn.passkey();
    if (error) {
      setBusy(false);
      // Closing the browser's passkey window isn't a problem worth a message.
      if (!("code" in error) || error.code !== "AUTH_CANCELLED") {
        setProblem("That passkey didn’t work. Try again, or sign in with your email and password.");
      }
      return;
    }
    window.location.assign(next); // a full load, so every page part sees the new session
  }
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={signIn}
        disabled={!hydrated || busy}
        className="inline-flex h-12 w-full items-center justify-center rounded-full border border-ink/25 px-7 font-semibold transition-colors hover:border-ink disabled:opacity-60"
      >
        {busy ? "Waiting for your passkey…" : label}
      </button>
      {problem ? (
        <p role="alert" className="mt-3 rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

export function SignInForm({
  next,
  signedInAs,
  notice,
  turnstileSiteKey,
}: {
  next: string;
  signedInAs?: string;
  notice?: string;
  /** Missing only in the instant placeholder, before the page knows its settings. */
  turnstileSiteKey?: string;
}) {
  return (
    <AuthShell
      title="Sign in"
      footer={
        <p>
          New to CeyLiving?{" "}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className={link}>
            Create an account
          </Link>
        </p>
      }
    >
      {notice ? (
        <p role="status" className="-mt-4 mb-6 rounded-md bg-sage px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}
      {signedInAs ? (
        <p role="status" className="-mt-4 mb-6 rounded-md bg-sage px-4 py-3 text-sm">
          You’re signed in as {signedInAs}.{" "}
          <Link href={next} className={link}>
            Continue
          </Link>
        </p>
      ) : null}
      <ActionForm action={signInAction} submitLabel="Sign in" pendingLabel="Signing in…">
        <input type="hidden" name="next" value={next} />
        <FormInput label="Email" name="email" type="email" autoComplete="email" required />
        <FormInput label="Password" name="password" type="password" autoComplete="current-password" required />
        <p className="text-right text-sm">
          <Link href="/forgot-password" className={link}>
            Forgot your password?
          </Link>
        </p>
        {/* AU-06: appears after 3 failed attempts; the server decides. */}
        {turnstileSiteKey ? <TurnstileField siteKey={turnstileSiteKey} /> : null}
      </ActionForm>
      <PasskeySignIn next={next} />
    </AuthShell>
  );
}

export function RegisterForm({
  seller,
  next,
  turnstileSiteKey,
}: {
  seller: boolean;
  next: string;
  turnstileSiteKey: string;
}) {
  const signInHref = `/signin?next=${encodeURIComponent(next)}`;
  return (
    <AuthShell
      title={seller ? "Create an account to open a shop" : "Create an account"}
      footer={
        <p>
          Already have an account?{" "}
          <Link href={signInHref} className={link}>
            Sign in{seller ? " and continue your application" : ""}
          </Link>
        </p>
      }
    >
      {seller ? (
        <p className="-mt-4 mb-6 text-ink-soft">
          Start with an account. After you confirm your email, you’ll tell us about your work on the application form,
          and we’ll review your shop, usually within five working days.
        </p>
      ) : null}
      <ActionForm
        action={registerAction}
        submitLabel={seller ? "Create account and continue" : "Create account"}
        pendingLabel="Creating…"
        resetOnSuccess
        needsScript
      >
        <input type="hidden" name="next" value={next} />
        <FormInput label="Full name" name="name" autoComplete="name" required maxLength={80} />
        <FormInput label="Email" name="email" type="email" autoComplete="email" required />
        <FormInput
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
          helper="At least 10 characters. We check it isn’t one that has leaked in a data breach."
        />
        <TurnstileField siteKey={turnstileSiteKey} always />
      </ActionForm>
    </AuthShell>
  );
}

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  return (
    <AuthShell
      title="Forgot your password?"
      footer={
        <p>
          Remembered it?{" "}
          <Link href="/signin" className={link}>
            Sign in
          </Link>
        </p>
      }
    >
      <p className="-mt-4 mb-6 text-ink-soft">
        Enter the email you signed up with. If it has an account, we’ll send a link to choose a new password.
      </p>
      <ActionForm
        action={forgotPasswordAction}
        submitLabel="Send the link"
        pendingLabel="Sending…"
        resetOnSuccess
        needsScript
      >
        <FormInput label="Email" name="email" type="email" autoComplete="email" required />
        <TurnstileField siteKey={turnstileSiteKey} always />
      </ActionForm>
    </AuthShell>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <p>
          Link not working?{" "}
          <Link href="/forgot-password" className={link}>
            Ask for a new one
          </Link>
        </p>
      }
    >
      <ActionForm action={resetPasswordAction} submitLabel="Save new password" pendingLabel="Saving…">
        <input type="hidden" name="token" value={token} />
        <FormInput
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={128}
          required
          helper="At least 10 characters. Saving it signs you out on every device."
        />
      </ActionForm>
    </AuthShell>
  );
}

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} submitLabel="Change password" pendingLabel="Saving…" resetOnSuccess>
      <FormInput
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormInput
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
        helper="At least 10 characters. Your other devices are signed out."
      />
    </ActionForm>
  );
}

/** AU-02: the second step at sign-in, a code from the authenticator app or one of the recovery codes. */
export function TwoStepSignInForm({ next }: { next: string }) {
  const [method, setMethod] = useState<"app" | "recovery">("app");
  return (
    <AuthShell
      title="Enter your code"
      footer={
        <p>
          Not you, or took too long?{" "}
          <Link href={`/signin?next=${encodeURIComponent(next)}`} className={link}>
            Sign in again
          </Link>
        </p>
      }
    >
      <p className="-mt-4 mb-6 text-ink-soft">
        {method === "app"
          ? "Open your authenticator app and enter the 6-digit code for CeyLiving."
          : "Enter one of the recovery codes you saved when you set up two-step sign-in. Each one works once."}
      </p>
      <ActionForm key={method} action={verifyTwoStepAction} submitLabel="Continue" pendingLabel="Checking…">
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="next" value={next} />
        {method === "app" ? (
          <FormInput
            label="Code from your app"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
          />
        ) : (
          <FormInput label="Recovery code" name="code" autoComplete="off" spellCheck={false} maxLength={11} required />
        )}
      </ActionForm>
      <button
        type="button"
        onClick={() => setMethod(method === "app" ? "recovery" : "app")}
        className={`mt-6 text-sm ${link}`}
      >
        {method === "app" ? "Lost your phone? Use a recovery code" : "Use the code from your app instead"}
      </button>
    </AuthShell>
  );
}
