import Link from "next/link";
import { ModernTile, TraditionalTile } from "@/components/category/category-tiles";
import { BudgetChips } from "@/components/home/budget-chips";
import { FeaturedMakers } from "@/components/home/featured-makers";
import { LatheHero } from "@/components/home/lathe-hero";
import { TrustStrip } from "@/components/home/trust-strip";
import { SearchBox } from "@/components/layout/search-box";
import { ProductGrid } from "@/components/product/product-card";
import { Container, SectionHeading } from "@/components/ui/section-heading";
import { categories, filterAndSort, lowestPriceCents, type CatalogueProduct } from "@/lib/catalogue";
import { publicCatalogue, publicShops } from "@/lib/server/catalogue";

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

export default async function HomePage() {
  const products = await publicCatalogue();
  const shops = await publicShops();
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

      <FeaturedMakers lead={lead} others={otherMakers} />

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

      <BudgetChips products={products} />

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

      <TrustStrip />
    </>
  );
}
