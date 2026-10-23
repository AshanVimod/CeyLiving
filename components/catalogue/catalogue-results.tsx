import Link from "next/link";
import { parseProductQuery } from "@/lib/catalogue";
import { PAGE_SIZE } from "@/lib/config";
import { categories } from "@/lib/data/categories";
import { queryCatalogue } from "@/lib/server/catalogue";
import { ProductGrid, ProductGridSkeleton } from "../product/product-card";
import { FilterSidebar, ResultsToolbar } from "./filters";

type SearchParams = Record<string, string | string[] | undefined>;

interface CatalogueResultsProps {
  searchParams: Promise<SearchParams>;
  /** Fixed category for /c/[slug] pages; the category filter is hidden there. */
  category?: string;
  basePath: string;
}

export async function CatalogueResults({ searchParams, category, basePath }: CatalogueResultsProps) {
  const raw = await searchParams;
  const query = parseProductQuery(raw);
  if (category) query.category = category;
  const limit = query.limit && query.limit > PAGE_SIZE ? query.limit : PAGE_SIZE;
  const { items, total, hasMore } = queryCatalogue({ ...query, limit });

  const moreParams = new URLSearchParams();
  Object.entries(raw).forEach(([k, v]) => {
    if (typeof v === "string") moreParams.set(k, v);
  });
  moreParams.set("limit", String(limit + PAGE_SIZE));

  return (
    <div className="grid gap-10 lg:grid-cols-[250px_1fr]">
      <FilterSidebar showCategory={!category} />
      <div>
        <ResultsToolbar total={total} showCategory={!category} />
        {items.length ? (
          <>
            <ProductGrid products={items} morph priorityCount={4} />
            {hasMore ? (
              <div className="mt-14 flex flex-col items-center gap-3">
                <p className="text-sm text-ink-soft">
                  Showing {items.length} of {total}
                </p>
                <Link
                  href={`${basePath}?${moreParams.toString()}`}
                  scroll={false}
                  className="inline-flex h-12 items-center rounded-full border border-ink/25 px-8 font-semibold hover:border-ink hover:bg-paper-raised"
                >
                  Load more
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyResults q={query.q} clearHref={query.q ? `${basePath}?q=${encodeURIComponent(query.q)}` : basePath} />
        )}
      </div>
    </div>
  );
}

function EmptyResults({ q, clearHref }: { q?: string; clearHref: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <h2 className="text-2xl">{q ? `No results for “${q}”` : "Nothing matches these filters"}</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">
        Try fewer filters or a wider price range. You can also browse one of these popular categories.
      </p>
      <Link
        href={clearHref}
        className="mt-6 inline-flex h-11 items-center rounded-full bg-forest px-6 font-semibold text-paper hover:bg-forest-deep"
      >
        Clear filters
      </Link>
      <ul className="mt-8 flex flex-wrap justify-center gap-2">
        {categories.slice(0, 6).map((c) => (
          <li key={c.slug}>
            <Link
              href={`/c/${c.slug}`}
              className="inline-flex min-h-10 items-center rounded-full border border-line bg-paper-raised px-4 text-sm hover:border-ink-soft"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CatalogueSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[250px_1fr]" aria-busy="true" aria-label="Loading products">
      <div className="hidden space-y-4 lg:block">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-6 rounded-sm" style={{ width: `${60 + ((i * 13) % 35)}%` }} />
        ))}
      </div>
      <div>
        <div className="mb-6 flex justify-between">
          <div className="skeleton h-6 w-24 rounded-sm" />
          <div className="skeleton h-11 w-44 rounded-full" />
        </div>
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
