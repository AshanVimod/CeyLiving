import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { PayoutForm, ShopProfileForm } from "@/components/seller/shop-forms";
import { sellerContext } from "@/lib/server/seller-context";

export const metadata = { title: "Shop profile" };

async function ShopProfile() {
  const { shop } = await sellerContext("/seller/shop");
  if (shop.status === "CLOSED") return <p className="text-ink-soft">This shop is closed.</p>;
  return (
    <>
      <PageTitle title="Shop profile" description="What customers see on your shop page." />
      <section className="rounded-lg border border-line bg-paper-raised p-5 sm:p-6">
        <ShopProfileForm shop={shop} />
      </section>
      <section
        id="payout"
        aria-labelledby="payout-h"
        className="mt-8 scroll-mt-40 rounded-lg border border-line bg-paper-raised p-5 sm:p-6"
      >
        <h2 id="payout-h" className="mb-1 text-2xl">
          Payout details
        </h2>
        <p className="mb-5 text-ink-soft">Earnings are paid weekly, 7 days after delivery.</p>
        <PayoutForm masked={shop.payoutAccountMasked} />
      </section>
    </>
  );
}

export default function SellerShopPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
      <ShopProfile />
    </Suspense>
  );
}
