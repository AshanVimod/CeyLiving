import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { ProductForm } from "@/components/seller/product-form";
import { APPROVED_ITEMS_FOR_AUTOPUBLISH } from "@/lib/config";
import { sellerContext } from "@/lib/server/seller-context";
import { approvedCount } from "@/lib/server/services/products";

export const metadata = { title: "Add an item" };

async function NewProduct() {
  const { shop, db } = await sellerContext("/seller/products/new");
  if (shop.status === "CLOSED") return <p className="text-ink-soft">This shop is closed.</p>;
  const approved = approvedCount(shop, db);
  return (
    <>
      <p className="mb-6 rounded-md bg-sage px-4 py-3 text-[0.95rem]">
        {approved >= APPROVED_ITEMS_FOR_AUTOPUBLISH
          ? "Submitted items go on sale straight away."
          : `Your first ${APPROVED_ITEMS_FOR_AUTOPUBLISH} items are checked by our team before they go on sale (${approved} approved so far).`}
      </p>
      <ProductForm />
    </>
  );
}

export default function NewProductPage() {
  return (
    <>
      <PageTitle title="Add an item" />
      <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
        <NewProduct />
      </Suspense>
    </>
  );
}
