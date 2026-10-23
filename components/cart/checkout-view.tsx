"use client";

import Link from "next/link";
import { useState } from "react";
import { summarizeCart } from "@/lib/cart-summary";
import { DISTRICTS } from "@/lib/districts";
import { formatLkr } from "@/lib/format";
import { selectCart, useStore } from "@/lib/store";
import { useCatalogueLookup } from "@/lib/use-catalogue-lookup";
import { Field } from "../forms/fields";
import { ShieldIcon } from "../ui/icons";
import { useHydrated } from "./cart-view";

export function CheckoutView() {
  const cart = useStore(selectCart);
  const hydrated = useHydrated();
  const lookup = useCatalogueLookup(cart.map((l) => l.productSlug));
  const { groups, subtotalCents, shippingCents, totalCents } = summarizeCart(cart, lookup.products);
  const [status, setStatus] = useState<"idle" | "invalid" | "demo">("idle");

  if (!hydrated || !lookup.ready) return <div className="skeleton h-96 rounded-lg" aria-busy="true" />;

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-6 py-16 text-center">
        <h2 className="text-2xl">There’s nothing to check out</h2>
        <Link
          href="/shop"
          className="mt-6 inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper"
        >
          Shop creations
        </Link>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    form
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")
      .forEach((el) => el.setAttribute("aria-invalid", String(!el.checkValidity())));
    if (!form.checkValidity()) {
      setStatus("invalid");
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    setStatus("demo");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-10 lg:grid-cols-[1fr_380px] lg:items-start">
      <div className="space-y-10">
        {status === "invalid" ? (
          <p role="alert" className="rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer">
            Some details are missing or invalid. They are marked below.
          </p>
        ) : null}
        <fieldset className="space-y-5">
          <legend className="mb-4 font-display text-2xl">Contact</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email" name="email" type="email" autoComplete="email" required />
            <Field
              label="Mobile number"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              pattern="^(\+94|0)7\d{8}$"
              required
              helper="For example 0771234567"
            />
          </div>
        </fieldset>
        <fieldset className="space-y-5">
          <legend className="mb-4 font-display text-2xl">Delivery address</legend>
          <Field label="Full name" name="name" autoComplete="name" required />
          <Field label="Address line 1" name="line1" autoComplete="address-line1" required />
          <Field label="Address line 2" name="line2" autoComplete="address-line2" helper="Optional" />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="City" name="city" autoComplete="address-level2" required />
            <div>
              <label htmlFor="district" className="mb-1.5 block text-[0.95rem] font-medium">
                District <span className="text-lacquer">*</span>
              </label>
              <select
                id="district"
                name="district"
                required
                defaultValue=""
                autoComplete="address-level1"
                className="h-12 w-full rounded-md border border-line bg-paper-raised px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
              >
                <option value="" disabled>
                  Choose
                </option>
                {DISTRICTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </div>
            <Field label="Postal code" name="postal" autoComplete="postal-code" inputMode="numeric" helper="Optional" />
          </div>
        </fieldset>
      </div>

      <aside aria-labelledby="checkout-summary" className="rounded-lg bg-sage p-6 lg:sticky lg:top-36">
        <h2 id="checkout-summary" className="font-display text-2xl">
          Your order
        </h2>
        <ul className="mt-5 space-y-4">
          {groups.map((g) => (
            <li key={g.shop.slug} className="border-b border-ink/10 pb-4 text-[0.95rem]">
              <p className="font-semibold">{g.shop.name}</p>
              {g.lines.map((l) => (
                <p key={l.key} className="mt-1 flex justify-between gap-3 text-ink-soft">
                  <span className="truncate">
                    {l.quantity} × {l.product.title}
                  </span>
                  <span className="tabular-nums">{formatLkr(l.lineTotalCents)}</span>
                </p>
              ))}
              <p className="mt-1 flex justify-between text-ink-soft">
                <span>Delivery</span>
                <span className="tabular-nums">{g.shippingCents ? formatLkr(g.shippingCents) : "Free"}</span>
              </p>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 text-[0.95rem]">
          <div className="flex justify-between">
            <dt>Items</dt>
            <dd className="tabular-nums">{formatLkr(subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery</dt>
            <dd className="tabular-nums">{shippingCents ? formatLkr(shippingCents) : "Free"}</dd>
          </div>
          <div className="flex justify-between border-t border-ink/15 pt-3 text-lg font-semibold">
            <dt>Total to pay</dt>
            <dd className="tabular-nums">{formatLkr(totalCents)}</dd>
          </div>
        </dl>
        <button
          type="submit"
          className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-forest font-semibold text-paper transition-[background-color,transform] hover:bg-forest-deep active:scale-[0.98]"
        >
          Continue to payment
        </button>
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
          <ShieldIcon size={18} className="mt-0.5 shrink-0 text-forest" />
          You’ll pay on PayHere’s secure page. CeyLiving never sees your card details.
        </p>
        {status === "demo" ? (
          <p role="status" className="mt-4 rounded-md bg-paper-raised p-3 text-sm">
            Payments aren’t switched on in this preview. Your details were checked but not sent anywhere.
          </p>
        ) : null}
      </aside>
    </form>
  );
}
