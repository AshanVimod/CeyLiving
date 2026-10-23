import type { Metadata } from "next";
import { Suspense } from "react";
import { accountNavItems } from "@/components/account/account-nav";
import { AreaShell } from "@/components/account/area-shell";
import { WishlistView } from "@/components/cart/wishlist-view";
import { Container } from "@/components/ui/section-heading";
import { currentUser } from "@/lib/server/auth";
import { notificationsOf } from "@/lib/server/repositories/people";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };

function WishlistBody() {
  return (
    <>
      <h1 className="text-[2.4rem] sm:text-[3rem]">Wishlist</h1>
      <p className="mt-2 mb-8 text-ink-soft">Saved on this device. Sign in to keep it across devices.</p>
      <WishlistView />
    </>
  );
}

/** Open to guests (saved in the browser); signed-in people see it inside their account. */
async function Wishlist() {
  const user = await currentUser();
  if (!user) {
    return (
      <Container className="pt-10">
        <WishlistBody />
      </Container>
    );
  }
  const unread = notificationsOf(user.id).filter((n) => !n.readAt).length;
  return (
    <AreaShell title="My account" navLabel="Account" items={accountNavItems(unread)} exact={["/account"]}>
      <WishlistBody />
    </AreaShell>
  );
}

export default function WishlistPage() {
  return (
    <Suspense
      fallback={
        <Container className="pt-10">
          <WishlistBody />
        </Container>
      }
    >
      <Wishlist />
    </Suspense>
  );
}
