import type { Metadata } from "next";
import { db } from "@/lib/server/db/tx";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BadgeList } from "@/components/product/badges";
import { Gallery } from "@/components/product/gallery";
import { ProductGrid } from "@/components/product/product-card";
import { PurchasePanel } from "@/components/product/purchase-panel";
import { Rating } from "@/components/product/rating";
import { RecentlyViewed } from "@/components/product/recently-viewed";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BadgeCheckIcon, ClockIcon, PinIcon, ReturnIcon, TruckIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/section-heading";
import { ReportButton } from "@/components/moderation/report-button";
import { ProductQuestions, ProductQuestionsSkeleton } from "@/components/questions/product-questions";
import { ProductReviewSlot } from "@/components/reviews/product-review-slot";
import { ProductReviews, ProductReviewsStatic } from "@/components/reviews/product-reviews";
import { lowestPriceCents } from "@/lib/catalogue";
import { FREE_SHIPPING_THRESHOLD_CENTS, SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";
import { getCategory } from "@/lib/data/categories";
import { formatLkr, photoUrl } from "@/lib/format";
import { getPublicProduct, getPublicShop, publicCatalogue, relatedProducts } from "@/lib/server/catalogue";
import { visibleReviewsOfProduct } from "@/lib/server/repositories/content";

export async function generateStaticParams() {
  return (await publicCatalogue()).map((p) => ({ productSlug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/p/[productSlug]">): Promise<Metadata> {
  const { productSlug } = await props.params;
  const product = await getPublicProduct(productSlug);
  if (!product) return {};
  const shop = await getPublicShop(product.shopSlug);
  return {
    title: product.title,
    description: `${product.description.slice(0, 140)} Made by ${shop?.ownerName ?? "an independent maker"}.`,
  };
}

function Detail({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-line">
      <summary className="flex min-h-14 list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <span className="relative size-4" aria-hidden="true">
          <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-ink" />
          <span className="absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-ink transition-transform duration-300 group-open:rotate-90 group-open:opacity-0" />
        </span>
      </summary>
      <div className="pb-5 text-ink-soft">{children}</div>
    </details>
  );
}

export default function ProductPage(props: PageProps<"/p/[productSlug]">) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductContent params={props.params} />
    </Suspense>
  );
}

function ProductSkeleton() {
  return (
    <Container className="pt-6 pb-10">
      <div aria-busy="true">
        <div className="skeleton h-5 w-56 rounded-sm" />
        <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <div className="skeleton aspect-[4/5] rounded-[3px]" />
          <div className="space-y-4">
            <div className="skeleton h-12 w-4/5 rounded-sm" />
            <div className="skeleton h-5 w-1/2 rounded-sm" />
            <div className="skeleton h-10 w-1/3 rounded-sm" />
            <div className="skeleton h-12 rounded-full" />
          </div>
        </div>
      </div>
    </Container>
  );
}

async function ProductContent({ params }: { params: PageProps<"/p/[productSlug]">["params"] }) {
  const { productSlug } = await params;
  // RULE-S4: hidden items and items of suspended shops return 404.
  const product = await getPublicProduct(productSlug);
  const shop = product ? await getPublicShop(product.shopSlug) : undefined;
  if (!product || !shop) notFound();
  const category = getCategory(product.categorySlug)!;
  const rating = product.rating;
  const reviews = await visibleReviewsOfProduct(db, product.id);
  const related = await relatedProducts(product);

  return (
    <Container className="pt-6 pb-10">
      <Breadcrumbs
        items={[
          { href: "/", label: "Home" },
          { href: `/c/${category.slug}`, label: category.name },
          { label: product.title },
        ]}
      />

      <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <div className="lg:sticky lg:top-36 lg:self-start">
          <Gallery images={product.images} slug={product.slug} />
        </div>

        <div>
          <BadgeList product={product} max={4} />
          <h1 className="mt-3 text-[2.1rem] sm:text-[2.6rem]">{product.title}</h1>
          <p className="mt-2 text-ink-soft">
            By{" "}
            <Link
              href={`/shop/${shop.slug}`}
              className="font-medium text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink"
            >
              {shop.ownerName}, {shop.name}
            </Link>
          </p>
          {rating !== undefined ? (
            <a href="#reviews" className="mt-2 inline-block rounded-sm">
              <Rating average={rating.average} count={rating.count} />
            </a>
          ) : null}

          <div className="mt-6">
            <PurchasePanel product={product} />
          </div>

          <ul className="mt-6 space-y-3 rounded-md bg-sage p-4 text-[0.95rem]">
            <li className="flex gap-3">
              <TruckIcon size={20} className="mt-0.5 shrink-0 text-forest" />
              <span>
                Delivery {formatLkr(SHIPPING_FEE_PER_SHOP_CENTS)} from this shop, free on orders over{" "}
                {formatLkr(FREE_SHIPPING_THRESHOLD_CENTS)}. {shop.dispatchDays}.
              </span>
            </li>
            {product.type === "MADE_TO_ORDER" ? (
              <li className="flex gap-3">
                <ClockIcon size={20} className="mt-0.5 shrink-0 text-forest" />
                <span>Made after you order. Processing time about {product.processingDays} days before dispatch.</span>
              </li>
            ) : null}
            <li className="flex gap-3">
              <ReturnIcon size={20} className="mt-0.5 shrink-0 text-forest" />
              <span>{shop.returnPolicy}</span>
            </li>
          </ul>

          <div className="mt-8 border-t border-line">
            <Detail title="Description" open>
              <p>{product.description}</p>
            </Detail>
            <Detail title="Materials and size">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <dt className="font-medium text-ink">Materials</dt>
                <dd>{product.materialNote}</dd>
                <dt className="font-medium text-ink">Dimensions</dt>
                <dd>{product.dimensions}</dd>
                <dt className="font-medium text-ink">Made in</dt>
                <dd>{shop.district} district, Sri Lanka</dd>
              </dl>
            </Detail>
            <Detail title="Care">
              <p>{product.care}</p>
            </Detail>
            {product.isCustomizable ? (
              <Detail title="Custom order terms">
                <p>
                  Personalized pieces are made for you and can’t be returned unless they arrive damaged or differ from
                  what you asked for. The maker will contact you through CeyLiving if anything is unclear.
                </p>
              </Detail>
            ) : null}
          </div>

          {/* Seller card */}
          <section aria-labelledby="maker-heading" className="mt-8 rounded-lg border border-line bg-paper-raised p-5">
            <div className="flex items-center gap-4">
              <span className="relative size-16 shrink-0 overflow-hidden rounded-full bg-sage">
                <Image
                  src={photoUrl((shop.portrait ?? shop.logo).id)}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </span>
              <div className="min-w-0">
                <h2 id="maker-heading" className="font-sans text-lg font-semibold">
                  {shop.ownerName}
                </h2>
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
                  <span className="inline-flex items-center gap-1">
                    <PinIcon size={14} /> {shop.district}
                  </span>
                  {shop.isVerified ? (
                    <span className="inline-flex items-center gap-1 text-forest">
                      <BadgeCheckIcon size={15} /> Verified maker
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            <p className="mt-4 text-ink-soft">{shop.story}</p>
            <Link
              href={`/shop/${shop.slug}`}
              className="mt-4 inline-flex h-11 items-center rounded-full border border-ink/20 px-5 text-sm font-semibold hover:border-ink"
            >
              Visit {shop.name}
            </Link>
          </section>
          <div className="mt-4 flex flex-wrap gap-x-4">
            <ReportButton targetType="PRODUCT" targetId={product.id} label="this item" />
            <ReportButton targetType="SHOP" targetId={shop.id} label={shop.name} />
          </div>
        </div>
      </div>

      <Suspense fallback={<ProductQuestionsSkeleton />}>
        <ProductQuestions productId={product.id} productSlug={product.slug} shop={shop} />
      </Suspense>

      {/* Reviews */}
      <section id="reviews" aria-labelledby="reviews-heading" className="mt-20 scroll-mt-40">
        <h2 id="reviews-heading" className="text-[1.85rem]">
          Reviews
        </h2>
        {reviews.length && rating ? (
          <>
            <div className="mt-3 mb-6">
              <Rating average={rating.average} count={rating.count} size={16} />
            </div>
            <Suspense fallback={<ProductReviewsStatic productId={product.id} shopName={shop.name} />}>
              <ProductReviews productId={product.id} shopName={shop.name} />
            </Suspense>
          </>
        ) : (
          <p className="mt-3 max-w-prose text-ink-soft">
            No reviews yet. Only customers who bought and received this piece can review it.
          </p>
        )}
        <div className="mt-8 max-w-2xl">
          <Suspense fallback={null}>
            <ProductReviewSlot productId={product.id} productSlug={product.slug} />
          </Suspense>
        </div>
      </section>

      {related.length ? (
        <section aria-labelledby="related-heading" className="mt-20">
          <h2 id="related-heading" className="mb-8 text-[1.85rem]">
            You might also like
          </h2>
          <ProductGrid products={related} morph />
        </section>
      ) : null}

      <RecentlyViewed currentSlug={product.slug} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.title,
            description: product.description,
            image: product.images.map((i) => photoUrl(i.id)),
            brand: { "@type": "Brand", name: shop.name },
            offers: {
              "@type": "Offer",
              priceCurrency: "LKR",
              price: (lowestPriceCents(product) / 100).toFixed(2),
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </Container>
  );
}
