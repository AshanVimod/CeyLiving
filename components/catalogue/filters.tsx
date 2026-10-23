"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { MATERIAL_LABELS, MATERIALS, SORTS, STYLE_LABELS, STYLES } from "@/lib/catalogue";
import { PRICE_CHIPS } from "@/lib/config";
import { categories } from "@/lib/data/categories";
import { CloseIcon, SlidersIcon } from "../ui/icons";

/** Reads and writes the filter query parameters from Section 3.3 of the spec. */
function useFilterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("limit");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { params, update, isPending };
}

function toggleListValue(p: URLSearchParams, key: string, value: string) {
  const list = (p.get(key) ?? "").split(",").filter(Boolean);
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  if (next.length) p.set(key, next.join(","));
  else p.delete(key);
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  const id = useId();
  return (
    <div className="flex min-h-10 items-center gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-[18px] shrink-0 cursor-pointer appearance-none rounded-[3px] border border-ink-soft/60 bg-paper-raised bg-center bg-no-repeat transition-colors checked:border-forest checked:bg-forest checked:bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22white%22%20stroke-width=%223%22><path%20d=%22m5%2012.5%204.5%204.5L19%207.5%22/></svg>')]"
      />
      <label htmlFor={id} className="cursor-pointer text-[0.95rem]">
        {label}
      </label>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-2 w-full font-semibold">{title}</legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

function PriceInputs() {
  const { params, update } = useFilterParams();
  const toRupees = (v: string | null) => (v ? String(Math.round(Number(v) / 100)) : "");
  const [min, setMin] = useState(toRupees(params.get("minPrice")));
  const [max, setMax] = useState(toRupees(params.get("maxPrice")));
  const [error, setError] = useState("");
  const errorId = useId();

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const minN = min ? Number(min) : undefined;
    const maxN = max ? Number(max) : undefined;
    if (minN !== undefined && maxN !== undefined && minN > maxN) {
      setError("Minimum must be lower than maximum.");
      return;
    }
    setError("");
    update((p) => {
      if (minN !== undefined) p.set("minPrice", String(minN * 100));
      else p.delete("minPrice");
      if (maxN !== undefined) p.set("maxPrice", String(maxN * 100));
      else p.delete("maxPrice");
    });
  }

  const currentMin = params.get("minPrice");
  const currentMax = params.get("maxPrice");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRICE_CHIPS.map((chip) => {
          const active =
            (currentMin ?? undefined) === (chip.minPrice !== undefined ? String(chip.minPrice) : undefined) &&
            (currentMax ?? undefined) === (chip.maxPrice !== undefined ? String(chip.maxPrice) : undefined);
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={active}
              onClick={() =>
                update((p) => {
                  if (active) {
                    p.delete("minPrice");
                    p.delete("maxPrice");
                    return;
                  }
                  if (chip.minPrice !== undefined) p.set("minPrice", String(chip.minPrice));
                  else p.delete("minPrice");
                  if (chip.maxPrice !== undefined) p.set("maxPrice", String(chip.maxPrice));
                  else p.delete("maxPrice");
                })
              }
              className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${
                active ? "border-forest bg-forest text-paper" : "border-line bg-paper-raised hover:border-ink-soft"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
      <form onSubmit={apply} className="flex items-end gap-2" noValidate>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink-soft">Min (LKR)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={min}
            onChange={(e) => setMin(e.target.value)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            className="h-11 w-full rounded-md border border-line bg-paper-raised px-3 tabular-nums focus:border-forest focus:outline-none"
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink-soft">Max (LKR)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            className="h-11 w-full rounded-md border border-line bg-paper-raised px-3 tabular-nums focus:border-forest focus:outline-none"
          />
        </label>
        <button type="submit" className="h-11 rounded-md border border-ink/20 px-4 text-sm font-semibold hover:border-ink">
          Apply
        </button>
      </form>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-lacquer">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FilterFields({ showCategory }: { showCategory: boolean }) {
  const { params, update } = useFilterParams();
  const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const styles = list("style");
  const materials = list("material");

  return (
    <div>
      {showCategory ? (
        <FilterGroup title="Category">
          <select
            value={params.get("category") ?? ""}
            onChange={(e) =>
              update((p) => {
                if (e.target.value) p.set("category", e.target.value);
                else p.delete("category");
              })
            }
            aria-label="Category"
            className="h-11 w-full rounded-md border border-line bg-paper-raised px-3 focus:border-forest focus:outline-none"
          >
            <option value="">All categories</option>
            <optgroup label="Traditional crafts">
              {categories.filter((c) => c.group === "TRADITIONAL").map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Modern design">
              {categories.filter((c) => c.group === "MODERN").map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </optgroup>
          </select>
        </FilterGroup>
      ) : null}
      <FilterGroup title="Price">
        {/* Remount when the URL range changes so the inputs show the applied values. */}
        <PriceInputs key={`${params.get("minPrice")}-${params.get("maxPrice")}`} />
      </FilterGroup>
      <FilterGroup title="Availability">
        <Checkbox
          label="In stock or made to order"
          checked={params.get("inStock") === "true"}
          onChange={() => update((p) => (p.get("inStock") === "true" ? p.delete("inStock") : p.set("inStock", "true")))}
        />
        <Checkbox
          label="Ready to ship"
          checked={params.get("type") === "READY_TO_SHIP"}
          onChange={() => update((p) => (p.get("type") === "READY_TO_SHIP" ? p.delete("type") : p.set("type", "READY_TO_SHIP")))}
        />
        <Checkbox
          label="Made to order"
          checked={params.get("type") === "MADE_TO_ORDER"}
          onChange={() => update((p) => (p.get("type") === "MADE_TO_ORDER" ? p.delete("type") : p.set("type", "MADE_TO_ORDER")))}
        />
        <Checkbox
          label="Can be personalized"
          checked={params.get("customizable") === "true"}
          onChange={() => update((p) => (p.get("customizable") === "true" ? p.delete("customizable") : p.set("customizable", "true")))}
        />
      </FilterGroup>
      <FilterGroup title="Style">
        {STYLES.map((s) => (
          <Checkbox key={s} label={STYLE_LABELS[s]} checked={styles.includes(s)} onChange={() => update((p) => toggleListValue(p, "style", s))} />
        ))}
      </FilterGroup>
      <FilterGroup title="Material">
        {MATERIALS.filter((m) => m !== "resin").map((m) => (
          <Checkbox key={m} label={MATERIAL_LABELS[m]} checked={materials.includes(m)} onChange={() => update((p) => toggleListValue(p, "material", m))} />
        ))}
      </FilterGroup>
    </div>
  );
}

export function FilterSidebar({ showCategory = true }: { showCategory?: boolean }) {
  return (
    <aside aria-label="Filters" className="hidden lg:block">
      <FilterFields showCategory={showCategory} />
    </aside>
  );
}

const FILTER_KEYS = ["category", "minPrice", "maxPrice", "style", "type", "customizable", "material", "inStock", "minRating"];

export function activeFilterCount(params: URLSearchParams, showCategory: boolean) {
  return FILTER_KEYS.filter((k) => (showCategory || k !== "category") && params.get(k)).length - (params.get("minPrice") && params.get("maxPrice") ? 1 : 0);
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
            onChange={(e) => update((p) => (e.target.value === "featured" ? p.delete("sort") : p.set("sort", e.target.value)))}
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
          <div className="absolute inset-0 bg-ink/40 animate-[scrim-in_200ms_ease-out]" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            className="absolute inset-y-0 right-0 flex w-[min(400px,92vw)] flex-col bg-paper animate-[drawer-in_320ms_var(--ease-out-soft)]"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-display text-xl">Filters</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close filters" className="grid size-11 place-items-center rounded-full hover:bg-sage">
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <FilterFields showCategory={showCategory} />
            </div>
            <div className="flex gap-3 border-t border-line px-5 py-4">
              <button
                type="button"
                onClick={() => update((p) => FILTER_KEYS.forEach((k) => (showCategory || k !== "category") && p.delete(k)))}
                className="h-12 flex-1 rounded-full border border-ink/20 font-semibold"
              >
                Clear all
              </button>
              <button type="button" onClick={() => setOpen(false)} className="h-12 flex-[1.4] rounded-full bg-forest font-semibold text-paper">
                Show {total} {total === 1 ? "piece" : "pieces"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
