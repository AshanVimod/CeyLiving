import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { FilterLinks } from "@/components/admin/data-table";
import { ProductDecisions } from "@/components/admin/product-decisions";
import { StatusBadge } from "@/components/ui/status-badge";
import { lowestPriceCents } from "@/lib/catalogue";
import { getCategory } from "@/lib/data/categories";
import { formatDate, formatLkr, photoUrl } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { db } from "@/lib/server/db/tx";
import { listProducts, listShops } from "@/lib/server/repositories/catalogue";

export const metadata = { title: "Items" };

const FILTERS = ["PENDING_REVIEW", "ACTIVE", "REJECTED", "REMOVED"] as const;

async function Products({ searchParams }: { searchParams: PageProps<"/admin/products">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/products");
  const { status } = await searchParams;
  const current = FILTERS.find((f) => f === status) ?? "PENDING_REVIEW";
  const [products, shops] = await Promise.all([listProducts(db), listShops(db)]);
  const items = products.filter((p) => p.status === current).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return (
    <>
      <FilterLinks
        current={current}
        items={FILTERS.map((f) => ({
          value: f,
          label: f === "PENDING_REVIEW" ? "Waiting" : f.charAt(0) + f.slice(1).toLowerCase(),
          href: `/admin/products?status=${f}`,
        }))}
      />
      {items.length ? (
        <ul className="space-y-4">
          {items.map((p) => {
            const shop = shops.find((s) => s.slug === p.shopSlug);
            return (
              <li
                key={p.id}
                className="grid gap-4 rounded-lg border border-line bg-paper-raised p-4 sm:grid-cols-[96px_1fr]"
              >
                <div className="relative aspect-[4/5] w-24 overflow-hidden rounded-[3px] bg-sage">
                  {p.images[0] ? (
                    <Image
                      src={photoUrl(p.images[0].id)}
                      alt={p.images[0].alt}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold">{p.title}</span>
                    <StatusBadge status={p.status} />
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {shop ? (
                      <Link href={`/admin/sellers/${shop.id}`} className="underline underline-offset-4">
                        {shop.name}
                      </Link>
                    ) : null}
                    {`, ${getCategory(p.categorySlug)?.name ?? "No category"}, ${p.variants.length ? formatLkr(lowestPriceCents(p)) : "no price"}, updated ${formatDate(p.updatedAt)}`}
                  </p>
                  <p className="mt-2 line-clamp-3 max-w-prose text-[0.95rem]">{p.description}</p>
                  {p.rejectionReason ? <p className="mt-2 text-sm text-lacquer">Reason: {p.rejectionReason}</p> : null}
                  <div className="mt-3">
                    <ProductDecisions productId={p.id} title={p.title} status={p.status} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="Nothing waiting" text="New items from new shops appear here for approval." />
      )}
    </>
  );
}

export default function AdminProductsPage(props: PageProps<"/admin/products">) {
  return (
    <>
      <PageTitle
        title="Items"
        description="New shops’ first items wait here. You can also remove items that break the rules."
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Products searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
