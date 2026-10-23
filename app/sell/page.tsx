import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CheckIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/section-heading";
import { COMMISSION_RATE_BPS, SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";
import { formatLkr, photoUrl } from "@/lib/format";

export const metadata: Metadata = {
  title: "Become a seller",
  description: "Open a shop on CeyLiving and sell your handmade work to customers across Sri Lanka.",
};

const commissionPercent = COMMISSION_RATE_BPS / 100;

const steps = [
  { title: "Apply", text: "Tell us about your work and send a few photos. It takes about ten minutes." },
  { title: "We review your shop", text: "We check that the work is yours and handmade. Most applications get an answer within five working days." },
  { title: "Set up and list", text: "Add your story, photos and prices. A checklist walks you through it." },
  { title: "Sell and get paid", text: "Accept orders, ship them, and receive payouts to your bank account every week." },
];

const eligible = [
  "You make the work yourself, or in a small workshop you run",
  "You are based in Sri Lanka and can ship within the island",
  "You have a Sri Lankan bank account for payouts",
  "Your work is original: no copies of other people's designs",
];

const notAllowed = [
  "Antiques that need export clearance",
  "Mass-produced or imported goods",
  "Counterfeit or copied designs",
  "Weapons or unsafe items",
];

export default function SellPage() {
  return (
    <>
      <section className="overflow-hidden">
        <Container className="grid items-center gap-10 pt-10 pb-4 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <h1 className="text-[2.5rem] leading-[1.06] sm:text-[3.6rem]">Your work, your shop, your price</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-soft">
              Open a shop on CeyLiving and reach customers across Sri Lanka. No monthly fee: we take {commissionPercent}% when
              you make a sale, and nothing when you don’t.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/sell/apply" className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep">
                Apply to sell
              </Link>
              <a href="#fees" className="inline-flex h-12 items-center rounded-full border border-ink/25 px-7 font-semibold hover:border-ink">
                See fees
              </a>
            </div>
          </div>
          <div className="arch relative aspect-[4/5] max-h-[520px] overflow-hidden bg-sage">
            <Image src={photoUrl("1595351298020-038700609878")} alt="Hands shaping clay on a pottery wheel" fill priority sizes="(min-width: 1024px) 45vw, 92vw" className="object-cover" />
          </div>
        </Container>
      </section>

      <Container className="mt-24">
        <h2 className="text-[1.85rem] sm:text-[2.25rem]">How it works</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="relative">
              <span className="grid size-10 place-items-center rounded-full bg-forest font-display text-lg text-paper">{i + 1}</span>
              <h3 className="mt-4 font-sans text-lg font-semibold">{s.title}</h3>
              <p className="mt-1 text-ink-soft">{s.text}</p>
            </li>
          ))}
        </ol>
      </Container>

      <section id="fees" aria-labelledby="fees-heading" className="mt-24 scroll-mt-40 bg-sage py-16">
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 id="fees-heading" className="text-[1.85rem] sm:text-[2.25rem]">
              Fees and payouts
            </h2>
            <p className="mt-3 max-w-md text-ink-soft">One simple fee. No listing fees, no monthly subscription.</p>
          </div>
          <dl className="divide-y divide-line rounded-lg bg-paper-raised">
            {[
              ["Commission", `${commissionPercent}% of the item price, taken only when you sell`],
              ["Card and payment fees", "Included in the commission"],
              ["Delivery", `Customers pay a flat ${formatLkr(SHIPPING_FEE_PER_SHOP_CENTS)} per order to your shop, passed on to you`],
              ["Payouts", "Weekly, to your bank account, 7 days after the customer receives the order"],
            ].map(([term, desc]) => (
              <div key={term} className="grid gap-1 p-5 sm:grid-cols-[180px_1fr]">
                <dt className="font-semibold">{term}</dt>
                <dd className="text-ink-soft">{desc}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <Container className="mt-24 grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="text-[1.6rem]">Who can sell</h2>
          <ul className="mt-5 space-y-3">
            {eligible.map((e) => (
              <li key={e} className="flex gap-3">
                <CheckIcon size={20} className="mt-0.5 shrink-0 text-forest" />
                {e}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-[1.6rem]">What can’t be listed</h2>
          <ul className="mt-5 list-disc space-y-3 pl-5 text-ink-soft marker:text-lacquer">
            {notAllowed.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </Container>

      <Container className="mt-24 text-center">
        <h2 className="text-[1.85rem] sm:text-[2.25rem]">Ready to open your shop?</h2>
        <Link href="/sell/apply" className="mt-6 inline-flex h-12 items-center rounded-full bg-forest px-8 font-semibold text-paper hover:bg-forest-deep">
          Apply to sell
        </Link>
      </Container>
    </>
  );
}
