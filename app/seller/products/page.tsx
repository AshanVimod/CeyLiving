import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { ArchiveButton } from "@/components/seller/archive-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { lowestPriceCents } from "@/lib/catalogue";
import { formatLkr } from "@/lib/format";
import { productsOfShop } from "@/lib/server/repositories/catalogue";
import { sellerContext } from "@/lib/server/seller-context";

export const metadata = { title: "Items" };

async function Products() {
  const { shop, db } = await sellerContext("/seller/products");
  const items = productsOfShop(shop.id, db).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!items.length) {
    return (
      <EmptyState
        title="No items yet"
        text="Add your first piece. It will be checked by our team before it goes on sale."
        action={
          <Link href="/seller/products/new" className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep">
            Add an item
          </Link>
        }
      />
    );
  }
  return (
    <DataTable caption="Your items" headers={["Item", "Status", "Price", "Stock", "Actions"]}>
      {items.map((p) => (
        <tr key={p.id}>
          <Td>
            <span className="font-semibold">{p.title}</span>
            {p.rejectionReason && (p.status === "REJECTED" || p.status === "REMOVED") ? <span className="mt-1 block text-sm text-lacquer">Reason: {p.rejectionReason}</span> : null}
          </Td>
          <Td>
            <StatusBadge status={p.status} />
          </Td>
          <Td className="tabular-nums">{p.variants.length ? formatLkr(lowestPriceCents(p)) : "None"}</Td>
          <Td className="tabular-nums">{p.type === "MADE_TO_ORDER" ? "Made to order" : p.variants.reduce((n, v) => n + v.stock, 0)}</Td>
          <Td>
            <div className="flex flex-wrap items-center gap-2">
              {p.status !== "REMOVED" && p.status !== "ARCHIVED" ? (
                <Link href={`/seller/products/${p.id}/edit`} className="inline-flex h-10 items-center rounded-full bg-forest px-4 text-sm font-semibold text-paper hover:bg-forest-deep">
                  Edit
                </Link>
              ) : null}
              {p.status === "ACTIVE" ? (
                <Link href={`/p/${p.slug}`} className="text-sm font-semibold text-forest underline underline-offset-4">
                  View
                </Link>
              ) : null}
              {p.status === "ARCHIVED" ? <ArchiveButton productId={p.id} title={p.title} restore /> : null}
              {["ACTIVE", "DRAFT", "PENDING_REVIEW", "REJECTED"].includes(p.status) ? <ArchiveButton productId={p.id} title={p.title} /> : null}
            </div>
          </Td>
        </tr>
      ))}
    </DataTable>
  );
}

export default function SellerProductsPage() {
  return (
    <>
      <PageTitle
        title="Items"
        description="Only active items appear in the catalogue."
        action={
          <Link href="/seller/products/new" className="inline-flex h-12 items-center rounded-full bg-forest px-6 font-semibold text-paper hover:bg-forest-deep">
            Add an item
          </Link>
        }
      />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Products />
      </Suspense>
    </>
  );
}
