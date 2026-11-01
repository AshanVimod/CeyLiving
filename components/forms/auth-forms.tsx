"use client";

import Link from "next/link";
import {
  changePasswordAction,
  forgotPasswordAction,
  registerAction,
  resetPasswordAction,
  signInAction,
} from "@/lib/server/actions/auth";
import { ActionForm, FormInput } from "./action-form";

// B05a: the real sign-in forms. Each posts to a server action (so nothing typed can reach the address bar), the
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

export function SignInForm({ next, signedInAs, notice }: { next: string; signedInAs?: string; notice?: string }) {
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
      </ActionForm>
    </AuthShell>
  );
}

export function RegisterForm({ seller, next }: { seller: boolean; next: string }) {
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
      </ActionForm>
    </AuthShell>
  );
}

export function ForgotPasswordForm() {
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
      <ActionForm action={forgotPasswordAction} submitLabel="Send the link" pendingLabel="Sending…" resetOnSuccess>
        <FormInput label="Email" name="email" type="email" autoComplete="email" required />
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
