"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CatalogueProduct } from "@/lib/catalogue";
import { ProductGrid } from "../product/product-card";

/**
 * "Load more" (B04b): fetches the next keyset page and adds it below the items already shown. Without JavaScript the
 * same button is a link to the next page. Pages continue after the last item shown, so an item added or removed
 * meanwhile never makes another one repeat or go missing.
 */
export function LoadMore({
  query,
  next,
  shown,
  total,
  basePath,
}: {
  /** The listing's own URL parameters (filters, sort, search words). */
  query: string;
  next: string;
  /** Items already on the page; undefined on a page opened through the no-JavaScript link, which can't know it. */
  shown?: number;
  total: number;
  basePath: string;
}) {
  const [items, setItems] = useState<CatalogueProduct[]>([]);
  const [cursor, setCursor] = useState<string | null>(next);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const withAfter = (after: string) => {
    const params = new URLSearchParams(query);
    params.set("after", after);
    return params.toString();
  };

  function load(event: React.MouseEvent) {
    if (!cursor) return;
    event.preventDefault();
    startTransition(async () => {
      try {
        const response = await fetch(`/api/catalogue/page?${withAfter(cursor)}`);
        if (!response.ok) throw new Error(String(response.status));
        const page = (await response.json()) as { items: CatalogueProduct[]; next: string | null };
        setItems((current) => [...current, ...page.items.filter((p) => !current.some((c) => c.id === p.id))]);
        setCursor(page.next);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <>
      {items.length ? (
        <div className="mt-9 lg:mt-12">
          <ProductGrid products={items} />
        </div>
      ) : null}
      {cursor ? (
        <div className="mt-14 flex flex-col items-center gap-3">
          <p className="text-sm text-ink-soft" aria-live="polite">
            {shown === undefined
              ? `${total} pieces in all`
              : `Showing ${Math.min(shown + items.length, total)} of ${total}`}
          </p>
          {failed ? (
            <p role="alert" className="text-sm text-lacquer">
              Couldn’t load more. Try again.
            </p>
          ) : null}
          <Link
            href={`${basePath}?${withAfter(cursor)}`}
            onClick={load}
            scroll={false}
            aria-busy={isPending}
            className="inline-flex h-12 items-center rounded-full border border-ink/25 px-8 font-semibold hover:border-ink hover:bg-paper-raised aria-busy:opacity-60"
          >
            {isPending ? "Loading…" : "Load more"}
          </Link>
        </div>
      ) : null}
    </>
  );
}
