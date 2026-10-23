import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductGrid } from "@/components/product/product-card";
import { Rating } from "@/components/product/rating";
import { BadgeCheckIcon, ClockIcon, PinIcon, ReturnIcon, TruckIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/section-heading";
import { ReviewList } from "@/components/reviews/review-list";
import { SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";
import { formatLkr, photoUrl } from "@/lib/format";
import { getPublicShop, publicProductsOfShop, publicShops, shopRating } from "@/lib/server/catalogue";
import { reviewsOfShop } from "@/lib/server/repositories/content";

export function generateStaticParams() {
  return publicShops().map((s) => ({ shopSlug: s.slug }));
}

export async function generateMetadata(props: PageProps<"/shop/[shopSlug]">): Promise<Metadata> {
  const { shopSlug } = await props.params;
  const shop = getPublicShop(shopSlug);
  return shop ? { title: shop.name, description: `${shop.craft} by ${shop.ownerName}, ${shop.district}.` } : {};
}

export default function ShopPage(props: PageProps<"/shop/[shopSlug]">) {
  return (
    <Suspense fallback={<div className="skeleton h-[320px]" aria-busy="true" />}>
      <ShopContent params={props.params} />
    </Suspense>
  );
}

async function ShopContent({ params }: { params: PageProps<"/shop/[shopSlug]">["params"] }) {
  const { shopSlug } = await params;
  // RULE-S4: suspended and closed shops return 404.
  const shop = getPublicShop(shopSlug);
  if (!shop) notFound();
  const items = publicProductsOfShop(shop.slug);
  const rating = shopRating(shop.slug);
  const productTitles = new Map(items.map((p) => [p.id, p.title]));
  // Reviews of items still on sale, newest first (D-07: keyed by review ID).
  const reviews = reviewsOfShop(shop.id)
    .filter((r) => r.status === "VISIBLE" && productTitles.has(r.productId))
    .slice(0, 6);

  return (
    <>
      <div className="relative h-[220px] bg-sage sm:h-[320px]">
        <Image src={photoUrl(shop.banner.id)} alt={shop.banner.alt} fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/35 to-transparent" />
      </div>
      <Container>
        <div className="relative -mt-14 flex flex-col gap-5 sm:-mt-16 sm:flex-row sm:items-end">
          <span className="relative size-28 shrink-0 overflow-hidden rounded-full border-[5px] border-paper bg-sage sm:size-32">
            <Image src={photoUrl(shop.logo.id)} alt={`${shop.name} logo`} fill sizes="128px" className="object-cover" />
          </span>
          <div className="pb-1">
            <h1 className="text-[2.2rem] sm:text-[2.8rem]">{shop.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-soft">
              <span>{shop.ownerName}</span>
              <span className="inline-flex items-center gap-1">
                <PinIcon size={15} /> {shop.district}
              </span>
              <span>Since {shop.since}</span>
              {shop.isVerified ? (
                <span className="inline-flex items-center gap-1 text-forest">
                  <BadgeCheckIcon size={16} /> Verified maker
                </span>
              ) : null}
            </p>
            {rating ? (
              <div className="mt-1">
                <Rating average={rating.average} count={rating.count} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_340px]">
          <section aria-labelledby="story-heading" className="max-w-2xl">
            <h2 id="story-heading" className="text-[1.6rem]">
              The story
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-ink-soft">{shop.story}</p>
            <blockquote className="mt-6 border-l-[3px] border-turmeric pl-5 font-display text-xl leading-snug">“{shop.quote}”</blockquote>
          </section>
          <aside aria-labelledby="policies-heading" className="h-fit rounded-lg border border-line bg-paper-raised p-5">
            <h2 id="policies-heading" className="font-sans text-base font-semibold">
              Shop policies
            </h2>
            <ul className="mt-4 space-y-3 text-[0.95rem] text-ink-soft">
              <li className="flex gap-3">
                <ClockIcon size={19} className="mt-0.5 shrink-0 text-forest" /> {shop.dispatchDays}
              </li>
              <li className="flex gap-3">
                <TruckIcon size={19} className="mt-0.5 shrink-0 text-forest" /> Delivery {formatLkr(SHIPPING_FEE_PER_SHOP_CENTS)} per order
              </li>
              <li className="flex gap-3">
                <ReturnIcon size={19} className="mt-0.5 shrink-0 text-forest" /> {shop.returnPolicy}
              </li>
            </ul>
          </aside>
        </div>

        <section aria-labelledby="work-heading" className="mt-16">
          <h2 id="work-heading" className="mb-8 text-[1.85rem]">
            Work by {shop.ownerName.split(" ")[0]} <span className="font-sans text-lg text-ink-soft">({items.length})</span>
          </h2>
          {items.length ? (
            <ProductGrid products={items} morph />
          ) : (
            <p className="text-ink-soft">This shop has no pieces listed right now.</p>
          )}
        </section>

        {reviews.length ? (
          <section aria-labelledby="shop-reviews-heading" className="mt-20">
            <h2 id="shop-reviews-heading" className="mb-6 text-[1.85rem]">
              What customers say
            </h2>
            <ReviewList reviews={reviews} shopName={shop.name} productTitles={productTitles} />
          </section>
        ) : null}
      </Container>
    </>
  );
}
