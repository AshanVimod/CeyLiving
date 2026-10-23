import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { ProductForm } from "@/components/seller/product-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { findProductById } from "@/lib/server/repositories/catalogue";
import { sellerContext } from "@/lib/server/seller-context";

export const metadata = { title: "Edit item" };

async function EditProduct({ params }: { params: PageProps<"/seller/products/[id]/edit">["params"] }) {
  const { id } = await params;
  const { shop, db } = await sellerContext(`/seller/products/${id}/edit`);
  // SEC-A2 / SEC-A5: only items of the seller's own shop; anything else is "not found".
  const found = await findProductById(db, id);
  const product = found?.shopSlug === shop.slug ? found : undefined;
  if (!product || product.status === "REMOVED") notFound();
  return (
    <>
      <PageTitle title={product.title} action={<StatusBadge status={product.status} />} />
      {product.rejectionReason && product.status === "REJECTED" ? (
        <p role="status" className="mb-6 rounded-md bg-lacquer/10 px-4 py-3 text-lacquer">
          Changes needed: {product.rejectionReason} Edit and submit again.
        </p>
      ) : null}
      <ProductForm product={product} />
      <p className="mt-6">
        <Link href="/seller/products" className="text-sm font-semibold text-forest underline underline-offset-4">
          Back to items
        </Link>
      </p>
    </>
  );
}

export default function EditProductPage(props: PageProps<"/seller/products/[id]/edit">) {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
      <EditProduct params={props.params} />
    </Suspense>
  );
}
