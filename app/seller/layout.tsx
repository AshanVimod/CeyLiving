import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaShell, AreaSkeleton } from "@/components/account/area-shell";
import { sellerContext, sellerCounts } from "@/lib/server/seller-context";

export const metadata: Metadata = {
  title: { default: "Seller", template: "%s | CeyLiving seller" },
  robots: { index: false },
};

// Signed-in areas wait for the session and may redirect, so navigations into them are allowed to block.
export const instant = false;

async function SellerShell({ children }: { children: React.ReactNode }) {
  // SEC-A1: only sellers get in; every action re-checks the role and loads the shop by owner.
  const { shop } = await sellerContext("/seller");
  const c = await sellerCounts(shop.id, shop.slug);
  return (
    <AreaShell
      title={shop.name}
      navLabel="Seller"
      exact={["/seller"]}
      items={[
        { href: "/seller", label: "Dashboard" },
        { href: "/seller/shop", label: "Shop profile" },
        { href: "/seller/products", label: "Items", count: c.pendingItems },
        { href: "/seller/orders", label: "Orders", count: c.newOrders },
        { href: "/seller/questions", label: "Questions", count: c.unanswered },
        { href: "/seller/reviews", label: "Reviews" },
        { href: "/seller/requests", label: "Custom requests", count: c.openRequests },
        { href: "/seller/payouts", label: "Payouts" },
      ]}
    >
      {children}
    </AreaShell>
  );
}

export default function SellerLayout({ children }: LayoutProps<"/seller">) {
  return (
    <Suspense fallback={<AreaSkeleton />}>
      <SellerShell>{children}</SellerShell>
    </Suspense>
  );
}
