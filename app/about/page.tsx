import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/ui/section-heading";
import { COMMISSION_RATE_BPS } from "@/lib/config";
import { photoUrl } from "@/lib/format";

export const metadata: Metadata = {
  title: "About us",
  description: "Why CeyLiving exists and how we choose the makers who sell here.",
};

const principles = [
  {
    title: "Made by the seller",
    text: "Every shop belongs to the person or workshop that makes the work. No resellers, no factory stock.",
  },
  {
    title: "Nothing hidden",
    text: "Maker, materials, size, processing time, delivery fee and return policy are on every listing.",
  },
  {
    title: "Honest labels",
    text: "Heritage crafts are labelled as heritage. Promoted listings say Promoted. Ratings come only from real orders.",
  },
  {
    title: "Fair to makers",
    text: `Makers set their own prices and keep ${100 - COMMISSION_RATE_BPS / 100}% of each sale. Payouts go to their bank account every week.`,
  },
];

export default function AboutPage() {
  return (
    <>
      <Container className="grid items-center gap-10 pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div>
          <h1 className="text-[2.5rem] leading-[1.08] sm:text-[3.4rem]">A market for the people who make things</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-soft">
            Sri Lanka has extraordinary makers, but most of them sell to middlemen at the side of the road or wait for
            tourists who may not come. CeyLiving gives each of them a shop of their own, and gives customers a way to
            find original work and buy it directly.
          </p>
        </div>
        <div className="relative aspect-[4/3] overflow-hidden rounded-[3px] bg-sage">
          <Image
            src={photoUrl("1786468539080-81788bc3e8b3")}
            alt="Souvenir shop in Galle Fort filled with masks, paintings and handicrafts"
            fill
            priority
            sizes="(min-width: 1024px) 45vw, 92vw"
            className="object-cover"
          />
        </div>
      </Container>

      <Container className="mt-24">
        <h2 className="text-[1.85rem] sm:text-[2.25rem]">What we hold ourselves to</h2>
        <ul className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {principles.map((p) => (
            <li key={p.title} className="border-t-2 border-forest pt-5">
              <h3 className="font-sans text-xl font-semibold">{p.title}</h3>
              <p className="mt-2 max-w-md text-ink-soft">{p.text}</p>
            </li>
          ))}
        </ul>
      </Container>

      <Container className="mt-24">
        <div className="flex flex-col items-start gap-6 rounded-lg bg-forest-deep p-8 text-paper sm:p-12 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-[1.85rem]">Questions, ideas, or a maker we should meet?</h2>
            <p className="mt-2 text-paper/80">We read everything. Most messages get a reply within two working days.</p>
          </div>
          <Link
            href="/help#contact"
            className="inline-flex h-12 shrink-0 items-center rounded-full bg-paper px-7 font-semibold text-ink hover:bg-turmeric-soft"
          >
            Contact us
          </Link>
        </div>
      </Container>
    </>
  );
}
