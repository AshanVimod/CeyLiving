"use client";

import { useEffect, useRef, useState } from "react";
import { SORTS } from "@/lib/catalogue";
import { CloseIcon, SlidersIcon } from "../ui/icons";
import { FilterFields, useFilterParams } from "./filter-fields";

export function FilterSidebar({ showCategory = true }: { showCategory?: boolean }) {
  return (
    <aside aria-label="Filters" className="hidden lg:block">
      <FilterFields showCategory={showCategory} />
    </aside>
  );
}

const FILTER_KEYS = [
  "category",
  "minPrice",
  "maxPrice",
  "style",
  "type",
  "customizable",
  "material",
  "inStock",
  "minRating",
];

export function activeFilterCount(params: URLSearchParams, showCategory: boolean) {
  return (
    FILTER_KEYS.filter((k) => (showCategory || k !== "category") && params.get(k)).length -
    (params.get("minPrice") && params.get("maxPrice") ? 1 : 0)
  );
}

export function ResultsToolbar({ total, showCategory = true }: { total: number; showCategory?: boolean }) {
  const { params, update, isPending } = useFilterParams();
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(params, showCategory);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <p className="text-ink-soft" aria-live="polite">
        <span className={`tabular-nums transition-opacity ${isPending ? "opacity-50" : ""}`}>
          {total} {total === 1 ? "piece" : "pieces"}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-11 items-center gap-2 rounded-full border border-line bg-paper-raised px-4 text-sm font-semibold hover:border-ink-soft lg:hidden"
        >
          <SlidersIcon size={18} />
          Filters{count > 0 ? ` (${count})` : ""}
        </button>
        {count > 0 ? (
          <button
            type="button"
            onClick={() => update((p) => FILTER_KEYS.forEach((k) => (showCategory || k !== "category") && p.delete(k)))}
            className="hidden h-11 rounded-full px-3 text-sm font-semibold text-forest underline underline-offset-4 lg:block"
          >
            Clear filters
          </button>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-soft max-sm:sr-only">Sort by</span>
          <select
            value={params.get("sort") ?? "featured"}
            onChange={(e) =>
              update((p) => (e.target.value === "featured" ? p.delete("sort") : p.set("sort", e.target.value)))
            }
            className="h-11 rounded-full border border-line bg-paper-raised pl-4 pr-8 font-medium focus:border-forest focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div
            className="absolute inset-0 bg-ink/40 animate-[scrim-in_200ms_ease-out]"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="absolute inset-y-0 right-0 flex w-[min(400px,92vw)] flex-col bg-paper animate-[drawer-in_320ms_var(--ease-out-soft)]"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-display text-xl">Filters</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className="grid size-11 place-items-center rounded-full hover:bg-sage"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <FilterFields showCategory={showCategory} />
            </div>
            <div className="flex gap-3 border-t border-line px-5 py-4">
              <button
                type="button"
                onClick={() =>
                  update((p) => FILTER_KEYS.forEach((k) => (showCategory || k !== "category") && p.delete(k)))
                }
                className="h-12 flex-1 rounded-full border border-ink/20 font-semibold"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-12 flex-[1.4] rounded-full bg-forest font-semibold text-paper"
              >
                Show {total} {total === 1 ? "piece" : "pieces"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
