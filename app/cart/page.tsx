import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Cart", robots: { index: false } };

export default function CartPage() {
  return (
    <Container className="pt-10">
      <h1 className="mb-8 text-[2.4rem] sm:text-[3rem]">Your cart</h1>
      <CartView />
    </Container>
  );
}
