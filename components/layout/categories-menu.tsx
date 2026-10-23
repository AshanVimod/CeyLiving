"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { categories } from "@/lib/data/categories";
import { photoUrl } from "@/lib/format";
import { ChevronDownIcon } from "../ui/icons";

export function CategoriesMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const traditional = categories.filter((c) => c.group === "TRADITIONAL");
  const modern = categories.filter((c) => c.group === "MODERN");

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-1 rounded-sm px-1 font-medium text-ink transition-colors hover:text-forest"
      >
        Categories
        <ChevronDownIcon size={16} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        id={panelId}
        onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
        hidden={!open}
        className="absolute left-0 top-full z-40 mt-2 w-[min(860px,calc(100vw-3rem))] rounded-lg border border-line bg-paper-raised p-6 shadow-[0_24px_60px_-28px_rgb(19_36_28/0.5)] animate-[toast-in_200ms_var(--ease-out-soft)]"
      >
        <div className="grid grid-cols-[1fr_1.6fr] gap-8">
          <div>
            <h2 className="mb-1 font-display text-lg">Traditional crafts</h2>
            <div className="lacquer-band mb-4 w-16" aria-hidden="true" />
            <ul className="space-y-1">
              {traditional.map((c) => (
                <li key={c.slug}>
                  <Link href={`/c/${c.slug}`} className="group flex items-center gap-3 rounded-md p-1.5 hover:bg-sage">
                    <span className="arch relative block h-12 w-10 shrink-0 overflow-hidden bg-sage">
                      <Image src={photoUrl(c.photo.id)} alt="" fill sizes="40px" className="object-cover" />
                    </span>
                    <span className="text-[0.95rem]">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-1 font-display text-lg">Modern design</h2>
            <div className="mb-4 h-[2px] w-16 bg-forest" aria-hidden="true" />
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              {modern.map((c) => (
                <li key={c.slug}>
                  <Link href={`/c/${c.slug}`} className="flex items-center gap-3 rounded-md p-1.5 hover:bg-sage">
                    <span className="relative block size-10 shrink-0 overflow-hidden rounded-sm bg-sage">
                      <Image src={photoUrl(c.photo.id)} alt="" fill sizes="40px" className="object-cover" />
                    </span>
                    <span className="text-[0.95rem]">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-sm">
          <span className="text-ink-soft">Not sure where to start?</span>
          <Link href="/shop" className="font-semibold text-forest underline-offset-4 hover:underline">
            Browse everything
          </Link>
        </div>
      </div>
    </div>
  );
}
