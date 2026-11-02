import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutView } from "@/components/cart/checkout-view";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section-heading";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

// Checkout waits for the session and may send the visitor to sign in, so navigations here are allowed to block.
export const instant = false;

/** AU-01 (B07): checkout needs an account; the place-order action checks the session and the email again. */
async function SignedInCheckout() {
  const user = await requireUser("/checkout");
  return <CheckoutView customer={{ name: user.name, phone: user.phone, emailVerified: user.emailVerified }} />;
}

export default function CheckoutPage() {
  return (
    <Container className="pt-6">
      <Breadcrumbs items={[{ href: "/cart", label: "Cart" }, { label: "Checkout" }]} />
      <h1 className="mt-4 mb-8 text-[2.4rem] sm:text-[3rem]">Checkout</h1>
      <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
        <SignedInCheckout />
      </Suspense>
    </Container>
  );
}
