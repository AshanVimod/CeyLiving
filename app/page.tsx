import Image from "next/image";
import Link from "next/link";
import { ModernTile, TraditionalTile } from "@/components/category/category-tiles";
import { LatheHero } from "@/components/home/lathe-hero";
import { SearchBox } from "@/components/layout/search-box";
import { ProductGrid } from "@/components/product/product-card";
import { HandIcon, ReturnIcon, ShieldIcon, TruckIcon } from "@/components/ui/icons";
import { Container, SectionHeading } from "@/components/ui/section-heading";
import { categories, filterAndSort, lowestPriceCents, type CatalogueProduct } from "@/lib/catalogue";
import { PRICE_CHIPS } from "@/lib/config";
import { publicCatalogue, publicShops } from "@/lib/server/catalogue";
import { photoUrl } from "@/lib/format";

/** Picks products for each collection without repeats, so photo morphs never share a name. */
function collections(products: CatalogueProduct[], heroSlug: string) {
  const used = new Set<string>([heroSlug]);
  const take = (list: CatalogueProduct[], n: number) => {
    const picked = list.filter((p) => !used.has(p.slug)).slice(0, n);
    picked.forEach((p) => used.add(p.slug));
    return picked;
  };
  return {
    newArrivals: take(filterAndSort(products, { sort: "newest" }).items, 4),
    personalized: take(filterAndSort(products, { customizable: true }).items, 4),
    sustainable: take(
      products.filter((p) => p.isEcoFriendly),
      4,
    ),
    heritage: take(
      filterAndSort(products, { sort: "featured" }).items.filter((p) => p.isHeritage),
      4,
    ),
  };
}

function priceChipCount(products: CatalogueProduct[], min?: number, max?: number) {
  return products.filter((p) => {
    const price = lowestPriceCents(p);
    return (min === undefined || price >= min) && (max === undefined || price <= max);
  }).length;
}

export default function HomePage() {
  const products = publicCatalogue();
  const shops = publicShops();
  const districts = new Set(shops.map((s) => s.district)).size;
  // The mask leads the hero; if its shop is ever suspended, the top featured heritage piece takes its place.
  const hero =
    products.find((p) => p.slug === "naga-raksha-mask") ??
    filterAndSort(products, { sort: "featured" }).items.find((p) => p.isHeritage) ??
    products[0];
  const heroShop = shops.find((s) => s.slug === hero?.shopSlug);
  const { newArrivals, personalized, sustainable, heritage } = collections(products, hero?.slug ?? "");
  const featured = shops.filter((s) => s.portrait).slice(0, 4);
  const [lead, ...otherMakers] = featured;

  return (
    <>
      {/* Hero */}
      <section className="overflow-hidden">
        <Container className="grid items-center gap-10 pt-10 pb-16 sm:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pt-16 lg:pb-24">
          <div className="max-w-xl">
            <h1 className="text-[2.6rem] leading-[1.04] sm:text-[3.6rem] lg:text-[4.1rem]">
              <span className="line-reveal">
                <span style={{ "--delay": "0.05s" } as React.CSSProperties}>Made by hand</span>
              </span>{" "}
              <span className="line-reveal">
                <span style={{ "--delay": "0.17s" } as React.CSSProperties}>in Sri Lanka,</span>
              </span>{" "}
              <span className="line-reveal">
                <span className="text-forest" style={{ "--delay": "0.29s" } as React.CSSProperties}>
                  sold by the maker.
                </span>
              </span>
            </h1>
            <p
              className="fade-late mt-6 max-w-lg text-lg text-ink-soft"
              style={{ "--delay": "0.55s" } as React.CSSProperties}
            >
              Masks from Ambalangoda, lace from Galle, batik from Kandy and new work from designers across the island.
              You buy directly from the person who made it.
            </p>
            <div className="fade-late mt-8 flex flex-wrap gap-3" style={{ "--delay": "0.68s" } as React.CSSProperties}>
              <Link
                href="/shop"
                className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper transition-[background-color,transform] duration-200 hover:bg-forest-deep active:scale-[0.98]"
              >
                Shop creations
              </Link>
              <Link
                href="/sell"
                className="inline-flex h-12 items-center rounded-full border border-ink/25 px-7 font-semibold text-ink transition-colors hover:border-ink hover:bg-paper-raised"
              >
                Open your shop
              </Link>
            </div>
            <p className="fade-late mt-8 text-sm text-ink-soft" style={{ "--delay": "0.8s" } as React.CSSProperties}>
              {products.length} pieces from {shops.length} makers in {districts} districts, and growing.
            </p>
          </div>
          {hero && heroShop ? (
            <LatheHero
              photoId={hero.images[0]!.id}
              alt={hero.images[0]!.alt}
              caption={{
                title: hero.title,
                maker: heroShop.ownerName,
                place: heroShop.slug === "ambalangoda-mask-house" ? "Ambalangoda" : heroShop.district,
                priceCents: lowestPriceCents(hero),
                href: `/p/${hero.slug}`,
              }}
            />
          ) : null}
        </Container>
      </section>

      {/* Categories */}
      <section aria-labelledby="crafts-heading" className="border-t border-line pt-16 sm:pt-20">
        <Container>
          <SectionHeading
            id="crafts-heading"
            title="Browse by craft"
            description="Traditional crafts carried on by families for generations, beside new work from contemporary designers."
            link={{ href: "/shop", label: "Shop everything" }}
          />
          <div className="mb-3 flex items-center gap-3">
            <h3 className="font-sans text-base font-semibold">Traditional crafts</h3>
            <span className="lacquer-band w-12" aria-hidden="true" />
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-4">
            {categories
              .filter((c) => c.group === "TRADITIONAL")
              .map((c) => (
                <li key={c.slug}>
                  <TraditionalTile category={c} />
                </li>
              ))}
          </ul>
          <div className="mt-14 mb-3 flex items-center gap-3">
            <h3 className="font-sans text-base font-semibold">Modern design</h3>
            <span className="h-[2px] w-12 bg-forest" aria-hidden="true" />
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-8">
            {categories
              .filter((c) => c.group === "MODERN")
              .map((c) => (
                <li key={c.slug}>
                  <ModernTile category={c} />
                </li>
              ))}
          </ul>
        </Container>
      </section>

      {/* Featured makers */}
      {lead ? (
        <section aria-labelledby="makers-heading" className="mt-24">
          <Container>
            <SectionHeading
              id="makers-heading"
              title="The people behind the work"
              description="Every shop is reviewed before it opens. Read the maker's story on each listing."
              link={{ href: "/makers", label: "Meet all makers" }}
            />
            <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
              <Link
                href={`/shop/${lead.slug}`}
                className="group grid gap-6 rounded-sm sm:grid-cols-[1fr_1.1fr] sm:items-end"
              >
                <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sage">
                  <Image
                    src={photoUrl(lead.portrait!.id)}
                    alt={lead.portrait!.alt}
                    fill
                    sizes="(min-width: 1024px) 340px, (min-width: 640px) 45vw, 92vw"
                    className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
                  />
                </div>
                <div className="pb-2">
                  <blockquote className="font-display text-2xl leading-snug sm:text-[1.7rem]">
                    “{lead.quote}”
                  </blockquote>
                  <p className="mt-5 font-semibold">{lead.ownerName}</p>
                  <p className="text-ink-soft">
                    {lead.name}, {lead.district}
                  </p>
                  <p className="mt-4 text-ink-soft">
                    {lead.craft}. Making since {lead.since}.
                  </p>
                  <span className="mt-5 inline-block font-semibold text-forest underline decoration-forest/30 underline-offset-[6px] group-hover:decoration-forest">
                    Visit the shop
                  </span>
                </div>
              </Link>
              <ul className="divide-y divide-line border-y border-line">
                {otherMakers.map((m) => (
                  <li key={m.slug}>
                    <Link href={`/shop/${m.slug}`} className="group flex items-center gap-4 py-4">
                      <span className="relative size-16 shrink-0 overflow-hidden rounded-full bg-sage">
                        <Image src={photoUrl(m.portrait!.id)} alt="" fill sizes="64px" className="object-cover" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold group-hover:text-forest">{m.ownerName}</span>
                        <span className="block text-sm text-ink-soft">
                          {m.craft}, {m.district}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        </section>
      ) : null}

      {/* New arrivals */}
      <section aria-labelledby="new-heading" className="mt-24">
        <Container>
          <SectionHeading
            id="new-heading"
            title="New arrivals"
            description="Listed in the last few weeks."
            link={{ href: "/shop?sort=newest", label: "See all new work" }}
          />
          <ProductGrid products={newArrivals} morph />
        </Container>
      </section>

      {/* Budget */}
      <section aria-labelledby="budget-heading" className="mt-24">
        <Container>
          <div className="rounded-lg bg-sage px-5 py-10 sm:px-10 sm:py-12">
            <h2 id="budget-heading" className="text-[1.85rem] sm:text-[2.25rem]">
              Shop to your budget
            </h2>
            <p className="mt-2 max-w-xl text-ink-soft">Pick a price range, or set your own on the shop page.</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-3">
              {PRICE_CHIPS.map((chip) => {
                const params = new URLSearchParams();
                if (chip.minPrice !== undefined) params.set("minPrice", String(chip.minPrice));
                if (chip.maxPrice !== undefined) params.set("maxPrice", String(chip.maxPrice));
                return (
                  <li key={chip.label}>
                    <Link
                      href={`/shop?${params.toString()}`}
                      className="group flex h-full items-center justify-between gap-4 rounded-md border border-ink/15 bg-paper-raised px-5 py-5 transition-[border-color,transform] duration-200 hover:border-forest active:scale-[0.99]"
                    >
                      <span>
                        <span className="block font-display text-xl">{chip.label}</span>
                        <span className="text-sm text-ink-soft">
                          {priceChipCount(products, chip.minPrice, chip.maxPrice)} pieces
                        </span>
                      </span>
                      <span
                        className="grid size-10 place-items-center rounded-full bg-forest text-paper transition-transform duration-300 group-hover:translate-x-1"
                        aria-hidden="true"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        >
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </Container>
      </section>

      {/* Personalized */}
      <section aria-labelledby="personal-heading" className="mt-24">
        <Container>
          <SectionHeading
            id="personal-heading"
            title="Personalized gifts"
            description="Names, dates, portraits and colours chosen by you. Made after you order."
            link={{ href: "/custom", label: "All custom work" }}
          />
          <ProductGrid products={personalized} morph />
        </Container>
      </section>

      {/* Heritage */}
      <section aria-labelledby="heritage-heading" className="mt-24 bg-forest-deep text-paper">
        <div className="lacquer-band" aria-hidden="true" />
        <Container className="py-16 sm:py-20">
          <SectionHeading
            id="heritage-heading"
            tone="dark"
            title="Sri Lankan heritage"
            description="Crafts with centuries behind them: Kolam masks, Beeralu lace, Dumbara weaving and batik. Each piece is labelled so you know what you're buying."
            link={{ href: "/heritage", label: "Explore heritage crafts" }}
          />
          <ProductGrid products={heritage} morph tone="dark" />
        </Container>
      </section>

      {/* Sustainable */}
      <section aria-labelledby="eco-heading" className="mt-24">
        <Container>
          <SectionHeading
            id="eco-heading"
            title="Sustainable finds"
            description="Reclaimed coconut shell, upcycled denim, recycled silver and natural fibres."
            link={{ href: "/c/eco-friendly", label: "Shop eco-friendly" }}
          />
          <ProductGrid products={sustainable} morph />
        </Container>
      </section>

      {/* Search prompt */}
      <section aria-labelledby="search-heading" className="mt-24">
        <Container className="max-w-3xl text-center">
          <h2 id="search-heading" className="text-[1.85rem] sm:text-[2.25rem]">
            Looking for something specific?
          </h2>
          <p className="mt-2 text-ink-soft">Search by craft, material, maker or district.</p>
          <div className="mt-6 text-left">
            <SearchBox size="large" />
          </div>
        </Container>
      </section>

      {/* Trust strip: only claims the platform actually enforces */}
      <section aria-label="How CeyLiving works" className="mt-24 border-y border-line bg-paper-raised">
        <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: HandIcon, title: "Every shop reviewed", text: "We check each maker before their shop goes live." },
            {
              icon: ShieldIcon,
              title: "Secure payment",
              text: "Pay by card through PayHere. We never see your card details.",
            },
            {
              icon: TruckIcon,
              title: "Delivery fee shown upfront",
              text: "One flat fee per shop, visible before you pay.",
            },
            {
              icon: ReturnIcon,
              title: "Return policy on every listing",
              text: "Each maker's terms are on the product page.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sage text-forest">
                <Icon size={22} />
              </span>
              <div>
                <h3 className="font-sans text-base font-semibold">{title}</h3>
                <p className="mt-0.5 text-sm text-ink-soft">{text}</p>
              </div>
            </div>
          ))}
        </Container>
      </section>
    </>
  );
}
