"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { lowestPriceCents, type LookupProduct } from "@/lib/catalogue";
import { formatLkr, photoUrl } from "@/lib/format";
import { useCatalogueLookup } from "@/lib/use-catalogue-lookup";

const KEY = "ceyliving:recent";
const noopSubscribe = () => () => {};

function readHistory(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseSlugs(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Shows the last few other products the customer looked at, then records this visit. Hidden items drop out (RULE-S4). */
export function RecentlyViewed({ currentSlug }: { currentSlug: string }) {
  const raw = useSyncExternalStore(noopSubscribe, readHistory, () => "[]");
  const slugs = useMemo(
    () =>
      parseSlugs(raw)
        .filter((s) => s !== currentSlug)
        .slice(0, 6),
    [raw, currentSlug],
  );
  const lookup = useCatalogueLookup(slugs);
  const items = slugs.map((s) => lookup.products.get(s)).filter((p): p is LookupProduct => Boolean(p));

  useEffect(() => {
    try {
      const history = parseSlugs(readHistory()).filter((s) => s !== currentSlug);
      window.localStorage.setItem(KEY, JSON.stringify([currentSlug, ...history].slice(0, 10)));
    } catch {
      // Storage unavailable: skip the history.
    }
  }, [currentSlug]);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="mt-20">
      <h2 id="recent-heading" className="mb-5 text-2xl">
        Recently viewed
      </h2>
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {items.map((p) => (
          <li key={p.slug}>
            <Link href={`/p/${p.slug}`} className="group block">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sage">
                <Image
                  src={photoUrl(p.image.id)}
                  alt={p.image.alt}
                  fill
                  sizes="(min-width: 640px) 180px, 30vw"
                  className="object-cover"
                />
              </div>
              <p className="mt-2 truncate text-sm group-hover:underline underline-offset-4">{p.title}</p>
              <p className="text-sm font-semibold tabular-nums">{formatLkr(lowestPriceCents(p))}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
