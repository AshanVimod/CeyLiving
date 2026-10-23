"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { categories } from "@/lib/data/categories";
import { CloseIcon, MenuIcon } from "../ui/icons";
import { LogoMark } from "./logo";
import { NAV_LINKS } from "./nav-links";

/** `account` holds the server-rendered Login/Sign Up or account entries, so the drawer matches the session. */
/** `sellLink` is chosen per role on the server (Open a shop, My shop application, Post an item, or nothing). */
export function MobileMenu({ account, sellLink }: { account?: React.ReactNode; sellLink?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = buttonRef.current;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="grid size-11 place-items-center rounded-full hover:bg-sage lg:hidden"
      >
        <MenuIcon />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-ink/40 animate-[scrim-in_200ms_ease-out]"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
            className="absolute inset-y-0 left-0 flex w-[min(340px,88vw)] flex-col overflow-y-auto bg-paper-raised animate-[drawer-in-left_320ms_var(--ease-out-soft)]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 font-display text-xl">
                <LogoMark size={24} /> CeyLiving
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-11 place-items-center rounded-full hover:bg-sage"
              >
                <CloseIcon />
              </button>
            </div>
            <nav aria-label="Main" className="px-4 py-4">
              <ul className="space-y-0.5">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="flex min-h-12 items-center rounded-md px-2 text-lg hover:bg-sage">
                      {l.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/account/wishlist"
                    className="flex min-h-12 items-center rounded-md px-2 text-lg hover:bg-sage"
                  >
                    Wishlist
                  </Link>
                </li>
                {account}
              </ul>
              <h2 className="mt-6 mb-2 px-2 font-display text-lg">Traditional crafts</h2>
              <ul>
                {categories
                  .filter((c) => c.group === "TRADITIONAL")
                  .map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/c/${c.slug}`}
                        className="flex min-h-11 items-center rounded-md px-2 text-ink-soft hover:bg-sage hover:text-ink"
                      >
                        {c.name}
                      </Link>
                    </li>
                  ))}
              </ul>
              <h2 className="mt-5 mb-2 px-2 font-display text-lg">Modern design</h2>
              <ul>
                {categories
                  .filter((c) => c.group === "MODERN")
                  .map((c) => (
                    <li key={c.slug}>
                      <Link
                        href={`/c/${c.slug}`}
                        className="flex min-h-11 items-center rounded-md px-2 text-ink-soft hover:bg-sage hover:text-ink"
                      >
                        {c.name}
                      </Link>
                    </li>
                  ))}
              </ul>
            </nav>
            {sellLink ? <div className="mt-auto border-t border-line p-4 empty:hidden">{sellLink}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
