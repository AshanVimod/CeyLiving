"use client";

import Link from "next/link";
import { useState } from "react";
import { Field } from "./fields";

function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-[2.4rem]">{title}</h1>
      <div className="mt-8">{children}</div>
      <div className="mt-8 border-t border-line pt-6 text-ink-soft">{footer}</div>
    </div>
  );
}

function usePreviewSubmit() {
  const [state, setState] = useState<"idle" | "invalid" | "preview">("idle");
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    form
      .querySelectorAll<HTMLInputElement>("input")
      .forEach((el) => el.setAttribute("aria-invalid", String(!el.checkValidity())));
    if (!form.checkValidity()) {
      setState("invalid");
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    setState("preview");
  }
  return { state, onSubmit };
}

function PreviewNotice({ state }: { state: string }) {
  if (state === "invalid")
    return (
      <p role="alert" className="rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer">
        Check the fields marked below.
      </p>
    );
  if (state === "preview")
    return (
      <p role="status" className="rounded-md bg-sage px-4 py-3 text-sm">
        Accounts aren’t switched on in this preview. Nothing was sent.
      </p>
    );
  return null;
}

export function SignInForm({ next, signedInAs }: { next: string; signedInAs?: string }) {
  const { state, onSubmit } = usePreviewSubmit();
  return (
    <AuthShell
      title="Sign in"
      footer={
        <p>
          New to CeyLiving?{" "}
          <Link
            href={`/register?next=${encodeURIComponent(next)}`}
            className="font-semibold text-forest underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      }
    >
      {signedInAs ? (
        <p role="status" className="-mt-4 mb-6 rounded-md bg-sage px-4 py-3 text-sm">
          You’re signed in as {signedInAs}.{" "}
          <Link href={next} className="font-semibold text-forest underline underline-offset-4">
            Continue
          </Link>
        </p>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <PreviewNotice state={state} />
        <Field label="Email" name="email" type="email" autoComplete="email webauthn" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <div className="flex justify-end">
          <Link href="/help#contact" className="text-sm font-medium text-forest underline underline-offset-4">
            Forgot your password?
          </Link>
        </div>
        <button
          type="submit"
          className="h-12 w-full rounded-full bg-forest font-semibold text-paper hover:bg-forest-deep active:scale-[0.98]"
        >
          Sign in
        </button>
        <button type="button" className="h-12 w-full rounded-full border border-ink/25 font-semibold hover:border-ink">
          Sign in with a passkey
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterForm({ seller, next }: { seller: boolean; next: string }) {
  const { state, onSubmit } = usePreviewSubmit();
  const signInHref = `/signin?next=${encodeURIComponent(next)}`;
  return (
    <AuthShell
      title={seller ? "Create an account to open a shop" : "Create an account"}
      footer={
        <p>
          Already have an account?{" "}
          <Link href={signInHref} className="font-semibold text-forest underline underline-offset-4">
            Sign in{seller ? " and continue your application" : ""}
          </Link>
        </p>
      }
    >
      {seller ? (
        <p className="-mt-4 mb-6 text-ink-soft">
          Start with an account. Next, you’ll tell us about your work on the application form, and we’ll review your
          shop, usually within five working days.
        </p>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <PreviewNotice state={state} />
        <Field label="Full name" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          helper="At least 10 characters."
        />
        <button
          type="submit"
          className="h-12 w-full rounded-full bg-forest font-semibold text-paper hover:bg-forest-deep active:scale-[0.98]"
        >
          {seller ? "Continue to shop details" : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}
