"use client";

import Image from "next/image";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { summarizeCart } from "@/lib/cart-summary";
import { FREE_SHIPPING_THRESHOLD_CENTS, MAX_CART_QUANTITY } from "@/lib/config";
import { formatLkr, photoUrl } from "@/lib/format";
import { removeLine, selectCart, setQuantity, useStore } from "@/lib/store";
import { useCatalogueLookup } from "@/lib/use-catalogue-lookup";
import { MinusIcon, PlusIcon } from "../ui/icons";
import { toast } from "../ui/toaster";

const noop = () => () => {};

/** True after hydration, so the server-rendered skeleton isn't replaced by an "empty cart" flash. */
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

function fieldLabel(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function CartView() {
  const cart = useStore(selectCart);
  const hydrated = useHydrated();
  const lookup = useCatalogueLookup(cart.map((l) => l.productSlug));
  const { groups, subtotalCents, shippingCents, totalCents, unavailable } = summarizeCart(cart, lookup.products);

  if (!hydrated || !lookup.ready) {
    return (
      <div className="grid gap-10 lg:grid-cols-[1fr_360px]" aria-busy="true">
        <div className="space-y-4">
          <div className="skeleton h-32 rounded-lg" />
          <div className="skeleton h-32 rounded-lg" />
        </div>
        <div className="skeleton h-64 rounded-lg" />
      </div>
    );
  }

  if (lookup.error) {
    return (
      <div role="alert" className="rounded-lg border border-line bg-paper-raised px-6 py-10 text-center">
        <h2 className="text-2xl">We couldn’t load your cart</h2>
        <p className="mt-2 text-ink-soft">Check your connection and reload the page. Your items are still saved on this device.</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-16 text-center">
        <h2 className="text-2xl">Your cart is empty</h2>
        {unavailable.length ? (
          <p className="mx-auto mt-2 max-w-md text-ink-soft">Some items you added are no longer for sale and were left out.</p>
        ) : null}
        <p className="mx-auto mt-2 max-w-md text-ink-soft">Find something made by hand. Your cart is saved on this device.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/shop" className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep">
            Shop creations
          </Link>
          <Link href="/account/wishlist" className="inline-flex h-12 items-center rounded-full border border-ink/25 px-7 font-semibold hover:border-ink">
            View wishlist
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px] lg:items-start">
      <div className="space-y-8">
        {groups.map((g) => {
          const toFree = FREE_SHIPPING_THRESHOLD_CENTS - g.subtotalCents;
          return (
            <section key={g.shop.slug} aria-labelledby={`shop-${g.shop.slug}`} className="rounded-lg border border-line bg-paper-raised">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
                <h2 id={`shop-${g.shop.slug}`} className="font-sans text-base font-semibold">
                  From <Link href={`/shop/${g.shop.slug}`} className="underline decoration-ink/30 underline-offset-4 hover:decoration-ink">{g.shop.name}</Link>
                </h2>
                <p className="text-sm text-ink-soft">{g.shop.dispatchDays}</p>
              </header>
              <ul className="divide-y divide-line">
                {g.lines.map((line) => (
                  <li key={line.key} className="flex gap-4 px-5 py-5">
                    <Link href={`/p/${line.product.slug}`} className="relative h-28 w-22 shrink-0 overflow-hidden rounded-[3px] bg-sage">
                      <Image src={photoUrl(line.product.image.id)} alt={line.product.image.alt} fill sizes="88px" className="object-cover" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/p/${line.product.slug}`} className="font-medium hover:underline underline-offset-4">
                            {line.product.title}
                          </Link>
                          {line.product.variants.length > 1 ? <p className="text-sm text-ink-soft">{line.variant.label}</p> : null}
                          {Object.entries(line.customization).map(([k, v]) => (
                            <p key={k} className="text-sm text-ink-soft">
                              {line.product.customizationLabels[k] ?? fieldLabel(k)}: {v}
                            </p>
                          ))}
                        </div>
                        <p className="shrink-0 font-semibold tabular-nums">{formatLkr(line.lineTotalCents)}</p>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                        <div className="flex h-10 items-center rounded-full border border-line" role="group" aria-label={`Quantity of ${line.product.title}`}>
                          <button
                            type="button"
                            onClick={() => setQuantity(line.key, line.quantity - 1)}
                            disabled={line.quantity <= 1}
                            aria-label="Decrease quantity"
                            className="grid size-10 place-items-center rounded-full disabled:opacity-40"
                          >
                            <MinusIcon size={16} />
                          </button>
                          <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => setQuantity(line.key, line.quantity + 1)}
                            disabled={
                              line.quantity >= MAX_CART_QUANTITY ||
                              (line.product.type === "READY_TO_SHIP" && line.quantity >= line.variant.stock)
                            }
                            aria-label="Increase quantity"
                            className="grid size-10 place-items-center rounded-full disabled:opacity-40"
                          >
                            <PlusIcon size={16} />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            removeLine(line.key);
                            toast(`Removed ${line.product.title}`);
                          }}
                          className="min-h-10 rounded-sm px-2 text-sm font-medium text-ink-soft underline underline-offset-4 hover:text-lacquer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <footer className="flex flex-wrap justify-between gap-2 border-t border-line px-5 py-3 text-sm">
                <span className="text-ink-soft">
                  {g.shippingCents === 0
                    ? "Free delivery from this shop"
                    : `Delivery ${formatLkr(g.shippingCents)}. Add ${formatLkr(toFree)} more from this shop for free delivery.`}
                </span>
                <span className="font-semibold tabular-nums">Subtotal {formatLkr(g.subtotalCents)}</span>
              </footer>
            </section>
          );
        })}
      </div>

      <aside aria-labelledby="summary-heading" className="rounded-lg bg-sage p-6 lg:sticky lg:top-36">
        <h2 id="summary-heading" className="font-display text-2xl">
          Order summary
        </h2>
        <dl className="mt-5 space-y-2.5 text-[0.95rem]">
          <div className="flex justify-between">
            <dt>Items</dt>
            <dd className="tabular-nums">{formatLkr(subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>
              Delivery{" "}
              <span className="text-ink-soft">
                ({groups.length} {groups.length === 1 ? "shop" : "shops"})
              </span>
            </dt>
            <dd className="tabular-nums">{shippingCents ? formatLkr(shippingCents) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-ink/15 pt-3 text-lg font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatLkr(totalCents)}</dd>
          </div>
        </dl>
        <Link href="/checkout" className="mt-6 flex h-12 items-center justify-center rounded-full bg-forest font-semibold text-paper transition-[background-color,transform] hover:bg-forest-deep active:scale-[0.98]">
          Go to checkout
        </Link>
        <p className="mt-3 text-center text-sm text-ink-soft">Each shop ships separately. Prices are checked again at checkout.</p>
      </aside>
    </div>
  );
}
