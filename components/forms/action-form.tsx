"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useId, useRef } from "react";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { Field, TextArea } from "./fields";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const ErrorsContext = createContext<Record<string, string>>({});

/** Field error for `name` from the last submission. */
export function useFieldError(name: string): string | undefined {
  return useContext(ErrorsContext)[name];
}

/** First error for `name` or any nested key under it (e.g. "images.2.alt"). */
export function useFieldErrorUnder(name: string): string | undefined {
  const errors = useContext(ErrorsContext);
  const key = Object.keys(errors).find((k) => k === name || k.startsWith(`${name}.`));
  return key ? errors[key] : undefined;
}

interface ActionFormProps {
  action: ServerAction;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  /** Clears the form after a successful submit (e.g. after posting a question). */
  resetOnSuccess?: boolean;
  /** Extra buttons next to the main submit button (each can carry name/value). */
  extraButtons?: React.ReactNode;
  submitVariant?: "primary" | "secondary" | "danger";
  submitName?: string;
  submitValue?: string;
}

const variants = {
  primary: "bg-forest text-paper hover:bg-forest-deep",
  secondary: "border border-ink/25 text-ink hover:border-ink",
  danger: "bg-lacquer text-paper hover:bg-lacquer/90",
};

/**
 * A form wired to a server action. It keeps what the person typed when there are errors
 * (no automatic reset), disables the button while sending, and moves focus to the result.
 */
export function ActionForm(props: ActionFormProps) {
  const {
    action,
    children,
    submitLabel,
    pendingLabel = "Saving…",
    className = "",
    resetOnSuccess,
    extraButtons,
  } = props;
  const [state, dispatch, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const statusId = useId();

  useEffect(() => {
    if (!state) return;
    if (state.ok && resetOnSuccess) formRef.current?.reset();
    const firstError = !state.ok && state.fieldErrors ? Object.keys(state.fieldErrors)[0] : undefined;
    const target = firstError
      ? formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(firstError)}"]`)
      : null;
    (target ?? statusRef.current)?.focus();
  }, [state, resetOnSuccess]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return (
    <ErrorsContext.Provider value={state && !state.ok ? (state.fieldErrors ?? {}) : {}}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        className={`space-y-5 ${className}`}
        aria-describedby={state ? statusId : undefined}
      >
        {state ? (
          <p
            ref={statusRef}
            id={statusId}
            tabIndex={-1}
            role={state.ok ? "status" : "alert"}
            className={`rounded-md px-4 py-3 text-sm focus:outline-none ${state.ok ? "bg-sage text-ink" : "bg-lacquer/10 text-lacquer"}`}
          >
            {state.ok ? (state.message ?? "Saved.") : state.message}
          </p>
        ) : null}
        {children}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name={props.submitName}
            value={props.submitValue}
            disabled={pending}
            aria-disabled={pending}
            className={`inline-flex h-12 items-center gap-2 rounded-full px-7 font-semibold transition-[background-color,transform] active:scale-[0.98] disabled:opacity-60 ${variants[props.submitVariant ?? "primary"]}`}
          >
            {pending ? (
              <span
                className="size-4 animate-spin rounded-full border-2 border-current/40 border-t-current"
                aria-hidden="true"
              />
            ) : null}
            {pending ? pendingLabel : submitLabel}
          </button>
          {extraButtons}
        </div>
      </form>
    </ErrorsContext.Provider>
  );
}

type InputProps = React.ComponentProps<typeof Field> & { name: string };

/** Field that shows its own server-side error. */
export function FormInput(props: InputProps) {
  return <Field {...props} error={useFieldError(props.name) ?? props.error} />;
}

type TextAreaProps = React.ComponentProps<typeof TextArea> & { name: string };

export function FormTextArea(props: TextAreaProps) {
  return <TextArea {...props} error={useFieldError(props.name) ?? props.error} />;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  name: string;
  label: string;
  options: readonly (string | { value: string; label: string })[];
  placeholder?: string;
  helper?: string;
}

export function FormSelect({
  name,
  label,
  options,
  placeholder,
  helper,
  required,
  className = "",
  ...rest
}: SelectProps) {
  const id = useId();
  const error = useFieldError(name);
  const describedBy = [helper ? `${id}-help` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[0.95rem] font-medium">
        {label}
        {required ? <span className="text-lacquer"> *</span> : null}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className="h-12 w-full rounded-md border border-line bg-paper-raised px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
        {...rest}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </select>
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

export function FormCheckbox({
  name,
  label,
  value = "on",
  defaultChecked,
}: {
  name: string;
  label: React.ReactNode;
  value?: string;
  defaultChecked?: boolean;
}) {
  const id = useId();
  const error = useFieldError(name);
  return (
    <div>
      <div className="flex min-h-11 items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          value={value}
          defaultChecked={defaultChecked}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : undefined}
          className="mt-1 size-[18px] shrink-0 accent-forest"
        />
        <label htmlFor={id} className="text-[0.95rem]">
          {label}
        </label>
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-lacquer">
          {error}
        </p>
      ) : null}
    </div>
  );
}
