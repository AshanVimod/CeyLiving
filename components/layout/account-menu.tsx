"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { accountLinks } from "@/lib/account-links";
import type { SessionUser } from "@/lib/session";
import { UserIcon } from "../ui/icons";

interface AccountMenuProps {
  user: SessionUser;
  signOutAction: () => Promise<void>;
}

const itemClass =
  "flex min-h-11 w-full items-center px-4 text-left text-[0.95rem] text-ink transition-colors hover:bg-sage focus:bg-sage focus-visible:outline-offset-[-2px]";

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

/** Focuses an item by index, wrapping around; -1 is the last item. */
function focusMenuItem(menu: HTMLElement | null, index: number) {
  const list = menuItems(menu);
  if (list.length) list[(index + list.length) % list.length]?.focus();
}

/** Menu button following the WAI-ARIA pattern: arrows move, Escape closes and returns focus. */
export function AccountMenu({ user, signOutAction }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    focusMenuItem(menuRef.current, focusOnOpen.current === "last" ? -1 : 0);
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const menu = menuRef.current;
    const current = menuItems(menu).indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMenuItem(menu, current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusMenuItem(menu, current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusMenuItem(menu, 0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusMenuItem(menu, -1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user.name}`}
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((o) => !o);
        }}
        onKeyDown={onButtonKeyDown}
        className={`grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-sage active:bg-line/60 ${open ? "bg-sage" : ""}`}
      >
        <UserIcon size={20} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-paper-raised py-1.5 shadow-[0_18px_40px_-20px_rgb(19_36_28/0.45)] animate-[toast-in_180ms_var(--ease-out-soft)]"
        >
          <div className="border-b border-line px-4 pt-2 pb-3" role="none">
            <p className="truncate font-semibold">{user.name}</p>
            <p className="truncate text-sm text-ink-soft">{user.email}</p>
          </div>
          <div className="py-1" role="none">
            {accountLinks(user).map((l) => (
              <Link key={l.href} href={l.href} role="menuitem" tabIndex={-1} onClick={() => setOpen(false)} className={itemClass}>
                {l.label}
              </Link>
            ))}
          </div>
          <div role="separator" className="my-1 border-t border-line" />
          <form action={signOutAction} role="none">
            <button type="submit" role="menuitem" tabIndex={-1} className={itemClass}>
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
