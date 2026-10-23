"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Small count shown next to the label, e.g. unread or pending items. */
  count?: number;
}

/** Side menu from 768px, horizontal tabs below (FR-1). The current page is marked for screen readers too. */
export function SectionNav({ items, label, exact = [] }: { items: NavItem[]; label: string; exact?: string[] }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    exact.includes(href) ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
      <ul className="flex gap-1 border-b border-line md:flex-col md:border-b-0 md:border-l">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap px-3 text-[0.95rem] transition-colors md:-ml-px md:border-l-2 md:px-4 ${
                  active
                    ? "border-b-2 border-forest font-semibold text-ink md:border-b-0"
                    : "border-b-2 border-transparent text-ink-soft hover:text-ink md:border-b-0"
                }`}
              >
                {item.label}
                {item.count ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-lacquer px-1.5 text-[11px] font-semibold text-paper tabular-nums">
                    {item.count}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
