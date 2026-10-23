import type { Metadata } from "next";
import { CheckoutView } from "@/components/cart/checkout-view";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <Container className="pt-6">
      <Breadcrumbs items={[{ href: "/cart", label: "Cart" }, { label: "Checkout" }]} />
      <h1 className="mt-4 mb-8 text-[2.4rem] sm:text-[3rem]">Checkout</h1>
      <CheckoutView />
    </Container>
  );
}
