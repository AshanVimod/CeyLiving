"use client";

import { useFieldError, useFieldErrorUnder } from "../forms/action-form";

// Shared pieces of the item editor (FR-2c).

export const input =
  "h-11 w-full rounded-md border border-line bg-paper-raised px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer";
export const smallButton =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-ink/25 px-4 text-sm font-semibold hover:border-ink";

export function FieldError({ name, under = false }: { name: string; under?: boolean }) {
  const exact = useFieldError(name);
  const nested = useFieldErrorUnder(name);
  const error = under ? nested : exact;
  return error ? (
    <p role="alert" className="mt-1 text-sm text-lacquer">
      {error}
    </p>
  ) : null;
}

export function Labeled({
  label,
  name,
  children,
  required,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.95rem] font-medium">
        {label}
        {required ? <span className="text-lacquer"> *</span> : null}
      </span>
      {children}
      <FieldError name={name} />
    </label>
  );
}
