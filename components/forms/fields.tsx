"use client";

import { useId, useState } from "react";
import { EyeIcon } from "../ui/icons";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helper?: string;
}

/** Labelled input with helper and error text wired to aria-describedby. */
export function Field({ label, error, helper, required, className = "", type = "text", ...rest }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const describedBy = [helper ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[0.95rem] font-medium">
        {label}
        {required ? <span className="text-lacquer"> *</span> : null}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && visible ? "text" : type}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="h-12 w-full rounded-md border border-line bg-paper-raised px-3.5 text-base focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
          {...rest}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md text-ink-soft hover:text-ink"
          >
            <EyeIcon size={18} off={visible} />
          </button>
        ) : null}
      </div>
      {helper ? (
        <p id={`${id}-help`} className="mt-1 text-sm text-ink-soft">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-lacquer">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helper?: string;
  maxLength: number;
}

export function TextArea({
  label,
  error,
  helper,
  required,
  maxLength,
  className = "",
  onChange,
  ...rest
}: TextAreaProps) {
  const id = useId();
  const [length, setLength] = useState(String(rest.defaultValue ?? "").length);
  const describedBy = [helper ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-[0.95rem] font-medium">
          {label}
          {required ? <span className="text-lacquer"> *</span> : null}
        </label>
        <span className="text-xs tabular-nums text-ink-soft">
          {length}/{maxLength}
        </span>
      </div>
      <textarea
        id={id}
        required={required}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(e) => {
          setLength(e.target.value.length);
          onChange?.(e);
        }}
        className="min-h-32 w-full rounded-md border border-line bg-paper-raised px-3.5 py-3 text-base focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
        {...rest}
      />
      {helper ? (
        <p id={`${id}-help`} className="mt-1 text-sm text-ink-soft">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-sm text-lacquer">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A form that validates required fields on submit and shows a confirmation, since the API isn't connected yet. */
export function DemoForm({
  children,
  submitLabel,
  successTitle,
  successText,
}: {
  children: React.ReactNode;
  submitLabel: string;
  successTitle: string;
  successText: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "invalid">("idle");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      setState("invalid");
      form
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")
        .forEach((el) => el.setAttribute("aria-invalid", String(!el.checkValidity())));
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    setState("sending");
    window.setTimeout(() => setState("sent"), 700);
  }

  if (state === "sent") {
    return (
      <div
        role="status"
        className="rounded-lg border border-forest/30 bg-sage p-6 animate-[toast-in_300ms_var(--ease-out-soft)]"
      >
        <h3 className="font-display text-2xl">{successTitle}</h3>
        <p className="mt-2 text-ink-soft">{successText}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {state === "invalid" ? (
        <p role="alert" className="rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer">
          Some required fields are empty or invalid. They are marked below.
        </p>
      ) : null}
      {children}
      <button
        type="submit"
        disabled={state === "sending"}
        className="inline-flex h-12 items-center gap-2 rounded-full bg-forest px-7 font-semibold text-paper transition-[background-color,transform] hover:bg-forest-deep active:scale-[0.98] disabled:opacity-60"
      >
        {state === "sending" ? (
          <span
            className="size-4 animate-spin rounded-full border-2 border-paper/40 border-t-paper"
            aria-hidden="true"
          />
        ) : null}
        {state === "sending" ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}
