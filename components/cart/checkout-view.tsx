"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { placeOrderAction } from "@/lib/server/actions/checkout";
import { summarizeCart } from "@/lib/cart-summary";
import { DISTRICTS } from "@/lib/districts";
import { formatLkr } from "@/lib/format";
import { removeLines, selectCart, useStore } from "@/lib/store";
import { useCatalogueLookup } from "@/lib/use-catalogue-lookup";
import { Field } from "../forms/fields";
import { ShieldIcon } from "../ui/icons";
import { useHydrated } from "@/lib/use-hydrated";

/** The signed-in customer, from the page (the server checks again when the order is placed). */
export interface CheckoutCustomer {
  name: string;
  phone?: string;
  emailVerified: boolean;
}

/**
 * Backend plan 9.1 (B07): sends the cart lines (item, variant, quantity, personalisation), the delivery address and
 * an idempotency key made when the page opens. The server prices everything; the totals here are a preview.
 */
export function CheckoutView({ customer }: { customer: CheckoutCustomer }) {
  const cart = useStore(selectCart);
  const hydrated = useHydrated();
  const router = useRouter();
  const lookup = useCatalogueLookup(cart.map((l) => l.productSlug));
  const { groups, subtotalCents, shippingCents, totalCents } = summarizeCart(cart, lookup.products);
  const [invalid, setInvalid] = useState(false);
  // One key per visit to this page: a double click or a retry after a lost answer returns the same order.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, dispatch, pending] = useActionState(placeOrderAction, null);
  const submitted = useRef<string[]>([]);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok && "orderNumber" in state && state.orderNumber) {
      removeLines(submitted.current);
      // B08: straight on to PayHere (the pay page sends its form once); the order page offers "Pay now" later.
      router.replace(`/checkout/pay/${state.orderNumber}?go=1`);
      return;
    }
    statusRef.current?.focus();
  }, [state, router]);

  if (!hydrated || !lookup.ready) return <div className="skeleton h-96 rounded-lg" aria-busy="true" />;

  const placed = state?.ok === true;
  if (groups.length === 0 && !placed && !pending) {
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

  const lines = groups.flatMap((g) => g.lines);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const error = (name: string) => errors[`shippingAddress.${name}`];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    form
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=hidden]), select")
      .forEach((el) => el.setAttribute("aria-invalid", String(!el.checkValidity())));
    if (!form.checkValidity()) {
      setInvalid(true);
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    setInvalid(false);
    submitted.current = lines.map((l) => l.key);
    const data = new FormData(form);
    // BR-04: only what to buy; prices and totals are worked out again on the server.
    data.set(
      "lines",
      JSON.stringify(
        lines.map((l) => ({
          productSlug: l.productSlug,
          sku: l.sku,
          quantity: l.quantity,
          customization: l.customization,
        })),
      ),
    );
    startTransition(() => dispatch(data));
  }

  const blocked = !customer.emailVerified;

  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-10 lg:grid-cols-[1fr_380px] lg:items-start">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="space-y-10">
        {blocked ? (
          <p role="alert" className="rounded-md bg-turmeric-soft px-4 py-3 text-sm">
            Confirm your email address before you check out: use the link we emailed you when you signed up.
          </p>
        ) : null}
        {invalid ? (
          <p role="alert" className="rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer">
            Some details are missing or invalid. They are marked below.
          </p>
        ) : null}
        {state && !state.ok ? (
          <p
            ref={statusRef}
            tabIndex={-1}
            role="alert"
            className="rounded-md bg-lacquer/10 px-4 py-3 text-sm text-lacquer focus:outline-none"
          >
            {state.message}
            {state.fieldErrors?.lines ? ` ${state.fieldErrors.lines}` : ""}
          </p>
        ) : null}
        <fieldset className="space-y-5">
          <legend className="mb-4 font-display text-2xl">Delivery address</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Full name"
              name="recipientName"
              autoComplete="name"
              required
              defaultValue={customer.name}
              error={error("recipientName")}
            />
            <Field
              label="Mobile number"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              pattern="^(\+94|0)7\d{8}$"
              required
              defaultValue={customer.phone}
              helper="For example 0771234567"
              error={error("phone")}
            />
          </div>
          <Field label="Address line 1" name="line1" autoComplete="address-line1" required error={error("line1")} />
          <Field
            label="Address line 2"
            name="line2"
            autoComplete="address-line2"
            helper="Optional"
            error={error("line2")}
          />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="City" name="city" autoComplete="address-level2" required error={error("city")} />
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
            <Field
              label="Postal code"
              name="postalCode"
              autoComplete="postal-code"
              inputMode="numeric"
              helper="Optional"
              error={error("postalCode")}
            />
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
          disabled={!hydrated || pending || placed || blocked}
          aria-disabled={!hydrated || pending || placed || blocked}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-forest font-semibold text-paper transition-[background-color,transform] hover:bg-forest-deep active:scale-[0.98] disabled:opacity-60"
        >
          {pending || placed ? (
            <span
              className="size-4 animate-spin rounded-full border-2 border-current/40 border-t-current"
              aria-hidden="true"
            />
          ) : null}
          {pending || placed ? "Placing your order…" : "Place order"}
        </button>
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
          <ShieldIcon size={18} className="mt-0.5 shrink-0 text-forest" />
          You’ll pay on PayHere’s secure page. CeyLiving never sees your card details. Your items are held for 30
          minutes while you pay.
        </p>
      </aside>
    </form>
  );
}
