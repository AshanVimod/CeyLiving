"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { Suggestion } from "@/lib/catalogue";
import { SEARCH_DEBOUNCE_MS } from "@/lib/config";
import { SearchIcon } from "../ui/icons";

interface SearchBoxProps {
  defaultValue?: string;
  size?: "default" | "large";
  autoFocus?: boolean;
}

export function SearchBox({ defaultValue = "", size = "default", autoFocus }: SearchBoxProps) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Debounced server lookup (only public items); older requests are cancelled so results never arrive out of order.
  useEffect(() => {
    const q = value.trim();
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      if (q.length < 2) {
        setSuggestions([]);
        return;
      }
      fetch(`/api/catalogue?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((body: { suggestions: Suggestion[] }) => {
          setSuggestions(body.suggestions);
          setActive(-1);
        })
        .catch(() => undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [value]);

  const showList = open && value.trim().length >= 2 && suggestions.length > 0;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault();
      const s = suggestions[active];
      if (s) go(s.href);
    }
  }

  const large = size === "large";

  return (
    <form
      role="search"
      action="/search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q.length >= 2) go(`/search?q=${encodeURIComponent(q)}`);
        else inputRef.current?.focus();
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search CeyLiving
      </label>
      <span
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-soft ${large ? "left-5" : "left-3.5"}`}
      >
        <SearchIcon size={large ? 22 : 18} />
      </span>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        name="q"
        type="search"
        autoComplete="off"
        autoFocus={autoFocus}
        minLength={2}
        maxLength={100}
        value={value}
        placeholder="Search paintings, batik, gifts, or makers…"
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        className={`w-full rounded-full border border-line bg-paper-raised text-ink placeholder:text-ink-soft/80 transition-[border-color,box-shadow] duration-200 hover:border-ink-soft/50 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/25 [&::-webkit-search-cancel-button]:hidden ${
          large ? "h-14 pl-14 pr-32 text-base sm:text-lg" : "h-11 pl-10 pr-4 text-[0.95rem]"
        }`}
      />
      {large ? (
        <button
          type="submit"
          className="absolute right-1.5 top-1/2 h-11 -translate-y-1/2 rounded-full bg-forest px-6 text-sm font-semibold text-paper transition-colors hover:bg-forest-deep active:scale-[0.98]"
        >
          Search
        </button>
      ) : null}
      {showList ? (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-line bg-paper-raised py-1.5 shadow-[0_18px_40px_-20px_rgb(19_36_28/0.45)] animate-[scrim-in_160ms_ease-out]"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.href}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(s.href);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 text-[0.95rem] ${i === active ? "bg-sage" : ""}`}
            >
              <span className="truncate">{s.label}</span>
              <span className="shrink-0 text-xs text-ink-soft">{s.kind}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
