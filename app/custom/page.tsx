import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CustomRequestForm } from "@/components/requests/request-forms";
import { ProductGrid } from "@/components/product/product-card";
import { Container } from "@/components/ui/section-heading";
import { currentUser } from "@/lib/server/auth";
import { publicCatalogue, publicShops } from "@/lib/server/catalogue";

export const metadata: Metadata = {
  title: "Custom & personalized",
  description: "Portraits, nameplates, embroidered names and made-to-measure pieces from Sri Lankan makers.",
};

const steps = [
  { title: "Choose a piece or a maker", text: "Pick a personalized listing, or send a request to any maker below." },
  { title: "Tell them what you want", text: "Names, colours, sizes and a budget. Messages stay on CeyLiving." },
  {
    title: "Approve the quote",
    text: "The maker replies with a price and a date. Nothing is charged until you accept.",
  },
  { title: "They make it for you", text: "You’ll get updates as it’s made, and tracking when it ships." },
];

/** FR-14: signed-in customers send a request to a maker; others are asked to sign in first. */
async function RequestSlot() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="rounded-lg border border-line bg-paper-raised p-6">
        <p className="text-ink-soft">
          Sign in to send a request. Replies arrive in your account, and your contact details are never shared.
        </p>
        <Link
          href="/signin?next=%2Fcustom"
          className="mt-4 inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep"
        >
          Sign in to send a request
        </Link>
      </div>
    );
  }
  const shops = (await publicShops())
    .filter((s) => s.ownerId !== user.id)
    .map((s) => ({ value: s.id, label: `${s.name}: ${s.craft}` }));
  return <CustomRequestForm shops={shops} />;
}

export default async function CustomPage() {
  const customizable = (await publicCatalogue()).filter((p) => p.isCustomizable);
  return (
    <>
      <Container className="pt-10">
        <h1 className="max-w-3xl text-[2.5rem] leading-[1.08] sm:text-[3.4rem]">Made for one person</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft">
          Personalized gifts and made-to-order pieces. Add a name, choose the colours, or ask a maker for something new.
        </p>
      </Container>

      <Container className="mt-14">
        <h2 className="mb-8 text-[1.85rem]">Ready to personalize</h2>
        <ProductGrid products={customizable} morph />
      </Container>

      <section aria-labelledby="how-heading" className="mt-24 bg-sage py-16">
        <Container>
          <h2 id="how-heading" className="text-[1.85rem] sm:text-[2.25rem]">
            How custom orders work
          </h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title}>
                <span className="grid size-10 place-items-center rounded-full border border-forest font-display text-lg text-forest">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-sans text-lg font-semibold">{s.title}</h3>
                <p className="mt-1 text-ink-soft">{s.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <Container className="mt-20 grid gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="text-[1.85rem] sm:text-[2.25rem]">Request something new</h2>
          <p className="mt-3 max-w-md text-ink-soft">
            Describe what you have in mind. The maker will reply with a quote within three working days. Your contact
            details are never shared with the maker.
          </p>
        </div>
        <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
          <RequestSlot />
        </Suspense>
      </Container>
    </>
  );
}
