"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon } from "./icons";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; href: string };
}

const EVENT = "ceyliving:toast";

/** Shows a short confirmation without moving focus (announced politely to screen readers). */
export function toast(message: string, action?: Toast["action"]) {
  window.dispatchEvent(new CustomEvent<Omit<Toast, "id">>(EVENT, { detail: { message, action } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 0;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<Omit<Toast, "id">>).detail;
      const id = ++next;
      setItems((list) => [...list.slice(-2), { id, ...detail }]);
      window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md bg-ink px-4 py-3 text-sm text-paper shadow-[0_12px_32px_-12px_rgb(19_36_28/0.5)] animate-[toast-in_280ms_var(--ease-out-soft)]"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-turmeric text-ink">
            <CheckIcon size={14} />
          </span>
          <span className="flex-1">{t.message}</span>
          {t.action ? (
            <Link href={t.action.href} className="font-medium text-turmeric-soft underline underline-offset-4">
              {t.action.label}
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}
