"use client";

import { useEffect, useRef } from "react";

/**
 * Backend plan 9.1 step 5: the form the server built (fields and hash signed with the merchant secret there) that
 * takes the customer to PayHere's own page, where the card is entered (PAY-01). With `autoSubmit` (straight after
 * checkout) it sends itself once; the button works without JavaScript and for a retry.
 */
export function PayHereForm({
  action,
  fields,
  label,
  autoSubmit,
}: {
  action: string;
  fields: Record<string, string>;
  label: string;
  autoSubmit: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (!autoSubmit || sent.current) return;
    sent.current = true;
    ref.current?.requestSubmit();
  }, [autoSubmit]);
  return (
    <form ref={ref} method="post" action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep"
      >
        {label}
      </button>
    </form>
  );
}
