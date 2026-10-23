"use client";

import { useEffect, useState } from "react";
import type { LookupProduct } from "./catalogue";

interface LookupState {
  key: string;
  products: Map<string, LookupProduct>;
  error: boolean;
}

/**
 * Fetches public summaries for the given slugs from /api/catalogue.
 * `ready` stays false until the current slug list has loaded, so pages can show a skeleton instead of an empty state.
 */
export function useCatalogueLookup(slugs: string[]) {
  const key = [...new Set(slugs)].sort().join(",");
  const [state, setState] = useState<LookupState | null>(null);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    fetch(`/api/catalogue?slugs=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { products: LookupProduct[] }) =>
        setState({ key, products: new Map(body.products.map((p) => [p.slug, p])), error: false }),
      )
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ key, products: new Map(), error: Boolean(err) });
      });
    return () => controller.abort();
  }, [key]);

  if (!key) return { ready: true, error: false, products: new Map<string, LookupProduct>() };
  const current = state?.key === key ? state : null;
  return {
    ready: Boolean(current),
    error: current?.error ?? false,
    products: current?.products ?? new Map<string, LookupProduct>(),
  };
}
