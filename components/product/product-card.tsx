import Image from "next/image";
import Link from "next/link";
import { ViewTransition } from "react";
import { highestCompareAtCents, isAvailable, lowestPriceCents, type CatalogueProduct } from "@/lib/catalogue";
import { formatLkr, photoUrl } from "@/lib/format";
import { BadgeList } from "./badges";
import { Rating } from "./rating";
import { WishlistButton } from "./wishlist-button";

interface ProductCardProps {
  product: CatalogueProduct;
  /** Lets the photo morph into the product page. Only one card per product may set it on a page. */
  morph?: boolean;
  priority?: boolean;
  sizes?: string;
  tone?: "light" | "dark";
}

export function ProductCard({ product, morph = false, priority = false, sizes, tone = "light" }: ProductCardProps) {
  const dark = tone === "dark";
  const price = lowestPriceCents(product);
  const compareAt = highestCompareAtCents(product);
  const hasRange = new Set(product.variants.map((v) => v.priceCents)).size > 1;
  const rating = product.rating;
  const [main, second] = product.images;
  const available = isAvailable(product);

  const photo = (
    <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sage">
      {main ? (
        <Image
          src={photoUrl(main.id)}
          alt={main.alt}
          fill
          priority={priority}
          sizes={sizes ?? "(min-width: 1280px) 300px, (min-width: 1024px) 24vw, (min-width: 640px) 32vw, 48vw"}
          className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.04]"
        />
      ) : null}
      {second ? (
        <Image
          src={photoUrl(second.id)}
          alt=""
          fill
          sizes={sizes ?? "(min-width: 1280px) 300px, (min-width: 1024px) 24vw, (min-width: 640px) 32vw, 48vw"}
          className="object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100 max-md:hidden"
        />
      ) : null}
    </div>
  );

  return (
    <article className="group relative">
      <Link href={`/p/${product.slug}`} className="block rounded-[3px] focus-visible:outline-offset-4">
        {morph ? <ViewTransition name={`product-${product.slug}`}>{photo}</ViewTransition> : photo}
        <div className="pointer-events-none absolute left-2 top-2 z-10">
          <BadgeList product={product} />
        </div>
        <div className="mt-3 space-y-1">
          <h3
            className={`font-sans text-[0.98rem] font-medium leading-snug decoration-current/30 ${dark ? "text-paper" : "text-ink"} underline-offset-4 group-hover:underline`}
          >
            {product.title}
          </h3>
          {product.shopName ? (
            <p className={`text-sm ${dark ? "text-paper/70" : "text-ink-soft"}`}>{product.shopName}</p>
          ) : null}
          <p className="flex flex-wrap items-baseline gap-x-2 pt-0.5">
            <span className={`font-semibold tabular-nums ${dark ? "text-paper" : "text-ink"}`}>
              {hasRange ? "From " : ""}
              {formatLkr(price)}
            </span>
            {compareAt ? (
              <span className={`text-sm line-through tabular-nums ${dark ? "text-paper/70" : "text-ink-soft"}`}>
                <span className="sr-only">Was </span>
                {formatLkr(compareAt)}
              </span>
            ) : null}
            {!available ? (
              <span className={`text-sm ${dark ? "text-turmeric-soft" : "text-lacquer"}`}>Sold out</span>
            ) : null}
          </p>
          {rating !== undefined ? (
            <span className={dark ? "[&_.text-ink-soft]:text-paper/70" : ""}>
              <Rating average={rating.average} count={rating.count} size={12} />
            </span>
          ) : null}
        </div>
      </Link>
      <WishlistButton productSlug={product.slug} productTitle={product.title} />
    </article>
  );
}

export function ProductGrid({
  products,
  morph = false,
  priorityCount = 0,
  tone = "light",
}: {
  products: CatalogueProduct[];
  morph?: boolean;
  priorityCount?: number;
  tone?: "light" | "dark";
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12">
      {products.map((p, i) => (
        <li key={p.slug}>
          <ProductCard product={p} morph={morph} priority={i < priorityCount} tone={tone} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul
      className="grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="skeleton aspect-[4/5] rounded-[3px]" />
          <div className="skeleton mt-3 h-4 w-4/5 rounded-sm" />
          <div className="skeleton mt-2 h-3.5 w-1/2 rounded-sm" />
          <div className="skeleton mt-2 h-4 w-1/3 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}
