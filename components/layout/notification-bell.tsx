"use client";

import Link from "next/link";
import { startTransition, useEffect, useId, useRef, useState } from "react";
import { markNotificationsReadAction } from "@/lib/server/actions/community";
import type { Notification } from "@/lib/types";

const timeAgo = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relative(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return timeAgo.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return timeAgo.format(hours, "hour");
  return timeAgo.format(Math.round(hours / 24), "day");
}

function BellIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** FR-11: unread count, latest five, marked read when opened. Only the signed-in person's own (RULE-N1). */
export function NotificationBell({ items, unread }: { items: Notification[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const count = seen ? 0 : unread;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0 && !seen) {
      setSeen(true);
      startTransition(() => void markNotificationsReadAction());
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        className={`relative grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-sage active:bg-line/60 ${open ? "bg-sage" : ""}`}
      >
        <BellIcon />
        {count ? (
          <span
            className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lacquer px-1 text-[11px] font-semibold leading-none text-paper tabular-nums"
            aria-hidden="true"
          >
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-lg border border-line bg-paper-raised py-2 shadow-[0_18px_40px_-20px_rgb(19_36_28/0.45)] animate-[toast-in_180ms_var(--ease-out-soft)] max-sm:-right-12"
      >
        <p className="px-4 pt-1 pb-2 font-semibold">Notifications</p>
        {items.length ? (
          <ul>
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href || "/account/notifications"}
                  onClick={() => setOpen(false)}
                  className="flex flex-col px-4 py-2.5 hover:bg-sage focus-visible:outline-offset-[-2px]"
                >
                  <span className={`text-[0.95rem] ${n.readAt ? "" : "font-semibold"}`}>{n.title}</span>
                  <span className="text-xs text-ink-soft">{relative(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-2 text-sm text-ink-soft">Nothing new.</p>
        )}
        <Link
          href="/account/notifications"
          onClick={() => setOpen(false)}
          className="mt-1 block border-t border-line px-4 pt-3 pb-1 text-sm font-semibold text-forest underline underline-offset-4"
        >
          See all
        </Link>
      </div>
    </div>
  );
}
