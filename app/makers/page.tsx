import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BadgeCheckIcon, PinIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/section-heading";
import { publicProductsOfShop, publicShops, shopRating } from "@/lib/server/catalogue";
import { photoUrl } from "@/lib/format";

export const metadata: Metadata = {
  title: "Discover makers",
  description: "Meet the independent Sri Lankan makers who sell on CeyLiving.",
};

export default function MakersPage() {
  const shops = publicShops();
  const [first, ...rest] = shops;

  return (
    <>
      <Container className="pt-10 pb-6">
        <h1 className="max-w-3xl text-[2.5rem] leading-[1.08] sm:text-[3.4rem]">Meet the makers</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft">
          {shops.length} independent workshops and studios from across the island. Each one was reviewed before it could
          open, and each one sets its own prices.
        </p>
      </Container>

      {first ? (
        <Container className="mt-8">
          <Link href={`/shop/${first.slug}`} className="group grid overflow-hidden rounded-lg bg-forest-deep text-paper md:grid-cols-2">
            <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[440px]">
              <Image
                src={photoUrl(first.banner.id)}
                alt={first.banner.alt}
                fill
                priority
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
              />
            </div>
            <div className="flex flex-col justify-center p-7 sm:p-12">
              <p className="text-sm font-semibold text-turmeric-soft">Featured maker</p>
              <blockquote className="mt-3 font-display text-[1.7rem] leading-snug sm:text-[2.1rem]">“{first.quote}”</blockquote>
              <p className="mt-6 font-semibold">{first.ownerName}</p>
              <p className="text-paper/75">
                {first.name}, {first.district}
              </p>
              <p className="mt-5 max-w-md text-paper/80">{first.story}</p>
              <span className="mt-6 font-semibold text-turmeric-soft underline decoration-current/40 underline-offset-[6px] group-hover:decoration-current">
                Visit the shop
              </span>
            </div>
          </Link>
        </Container>
      ) : null}

      <Container className="mt-16">
        <h2 className="mb-8 text-[1.85rem]">All makers</h2>
        <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((s) => {
            const count = publicProductsOfShop(s.slug).length;
            const rating = shopRating(s.slug);
            return (
              <li key={s.slug}>
                <Link href={`/shop/${s.slug}`} className="group block">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-[3px] bg-sage">
                    <Image
                      src={photoUrl(s.banner.id)}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 400px, (min-width: 640px) 48vw, 92vw"
                      className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.04]"
                    />
                  </div>
                  <div className="mt-4 flex items-start gap-3">
                    <span className="relative -mt-10 size-16 shrink-0 overflow-hidden rounded-full border-4 border-paper bg-sage">
                      <Image src={photoUrl((s.portrait ?? s.logo).id)} alt="" fill sizes="64px" className="object-cover" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-sans text-lg font-semibold group-hover:text-forest">{s.name}</h3>
                      <p className="text-sm text-ink-soft">{s.ownerName}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-ink-soft">{s.craft}.</p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
                    <span className="inline-flex items-center gap-1">
                      <PinIcon size={14} /> {s.district}
                    </span>
                    <span>
                      {count} {count === 1 ? "piece" : "pieces"}
                    </span>
                    {rating ? <span className="tabular-nums">{rating.average.toFixed(1)} from {rating.count} reviews</span> : null}
                    {s.isVerified ? (
                      <span className="inline-flex items-center gap-1 text-forest">
                        <BadgeCheckIcon size={15} /> Verified
                      </span>
                    ) : null}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>
    </>
  );
}
