"use client";

import Image from "next/image";
import Link from "next/link";
import { isAvailable, lowestPriceCents, type LookupProduct } from "@/lib/catalogue";
import { formatLkr, photoUrl } from "@/lib/format";
import { addToCart, selectWishlist, toggleWishlist, useStore } from "@/lib/store";
import { useCatalogueLookup } from "@/lib/use-catalogue-lookup";
import { toast } from "../ui/toaster";
import { useHydrated } from "./cart-view";

export function WishlistView() {
  const slugs = useStore(selectWishlist);
  const hydrated = useHydrated();
  const lookup = useCatalogueLookup(slugs);
  const items = slugs.map((s) => lookup.products.get(s)).filter((p): p is LookupProduct => Boolean(p));

  if (!hydrated || !lookup.ready) return <div className="skeleton h-80 rounded-lg" aria-busy="true" />;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-16 text-center">
        <h2 className="text-2xl">Nothing saved yet</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-soft">Tap the heart on any piece to save it here.</p>
        <Link href="/shop" className="mt-6 inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep">
          Shop creations
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((p) => {
        const quickAdd = p.variants.length === 1 && !p.isCustomizable && isAvailable(p);
        return (
          <li key={p.slug} className="flex flex-col">
            <Link href={`/p/${p.slug}`} className="group block">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sage">
                <Image src={photoUrl(p.image.id)} alt={p.image.alt} fill sizes="(min-width: 1024px) 300px, (min-width: 640px) 48vw, 92vw" className="object-cover" />
              </div>
              <p className="mt-3 font-medium group-hover:underline underline-offset-4">{p.title}</p>
            </Link>
            <p className="text-sm text-ink-soft">{p.shop.name}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatLkr(lowestPriceCents(p))}
              {!isAvailable(p) ? <span className="ml-2 text-sm font-normal text-lacquer">Sold out</span> : null}
            </p>
            <div className="mt-3 flex gap-2">
              {quickAdd ? (
                <button
                  type="button"
                  onClick={() => {
                    addToCart(p.slug, p.variants[0]!.sku, 1, {});
                    toast(`Added ${p.title} to your cart`, { label: "View cart", href: "/cart" });
                  }}
                  className="h-11 flex-1 rounded-full bg-forest px-4 text-sm font-semibold text-paper hover:bg-forest-deep active:scale-[0.98]"
                >
                  Add to cart
                </button>
              ) : (
                <Link href={`/p/${p.slug}`} className="flex h-11 flex-1 items-center justify-center rounded-full border border-forest px-4 text-sm font-semibold text-forest hover:bg-forest hover:text-paper">
                  {p.isCustomizable ? "Personalize" : "Choose option"}
                </Link>
              )}
              <button
                type="button"
                onClick={() => toggleWishlist(p.slug)}
                className="h-11 rounded-full px-3 text-sm font-medium text-ink-soft underline underline-offset-4 hover:text-lacquer"
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
