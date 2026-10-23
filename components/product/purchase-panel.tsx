"use client";

import { useId, useState } from "react";
import { MAX_CART_QUANTITY } from "@/lib/config";
import { formatLkr } from "@/lib/format";
import { addToCart } from "@/lib/store";
import type { CustomizationField, Product } from "@/lib/types";
import { CheckIcon, MinusIcon, PlusIcon } from "../ui/icons";
import { toast } from "../ui/toaster";
import { WishlistButton } from "./wishlist-button";

/** Mirrors BR-16: required fields, max length and allowed options. The API re-checks all of it. */
function validate(fields: CustomizationField[], values: Record<string, string>) {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? "").trim();
    if (f.isRequired && !v) errors[f.key] = `Enter ${f.label.toLowerCase().replace(" (optional)", "")}.`;
    else if (v.length > f.maxLength) errors[f.key] = `Use ${f.maxLength} characters or fewer.`;
    else if (f.kind === "SELECT" && v && !f.options?.includes(v)) errors[f.key] = "Choose one of the options.";
  }
  return errors;
}

export function PurchasePanel({ product }: { product: Product }) {
  const firstAvailable =
    product.variants.find((v) => product.type === "MADE_TO_ORDER" || v.stock > 0) ?? product.variants[0]!;
  const [sku, setSku] = useState(firstAvailable.sku);
  const [quantity, setQuantity] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);
  const formId = useId();

  const variant = product.variants.find((v) => v.sku === sku) ?? firstAvailable;
  const madeToOrder = product.type === "MADE_TO_ORDER";
  const inStock = madeToOrder || variant.stock > 0;
  const maxQty = madeToOrder ? MAX_CART_QUANTITY : Math.min(MAX_CART_QUANTITY, variant.stock);
  const fields = product.customization ?? [];

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = validate(fields, values);
    setErrors(nextErrors);
    const firstError = Object.keys(nextErrors)[0];
    if (firstError) {
      document.getElementById(`${formId}-${firstError}`)?.focus();
      return;
    }
    const clean = Object.fromEntries(
      Object.entries(values)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    );
    addToCart(product.slug, variant.sku, quantity, clean);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
    toast(`Added ${product.title} to your cart`, { label: "View cart", href: "/cart" });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div>
        <p className="flex items-baseline gap-3">
          <span className="text-[1.75rem] font-semibold tabular-nums">{formatLkr(variant.priceCents)}</span>
          {variant.compareAtPriceCents && variant.compareAtPriceCents > variant.priceCents ? (
            <span className="text-lg text-ink-soft line-through tabular-nums">
              <span className="sr-only">Was </span>
              {formatLkr(variant.compareAtPriceCents)}
            </span>
          ) : null}
        </p>
        <p className={`mt-1 text-sm ${inStock ? "text-forest" : "text-lacquer"}`}>
          {madeToOrder
            ? `Made to order: ready to ship in about ${product.processingDays} days`
            : variant.stock === 0
              ? "Sold out in this option"
              : variant.stock <= 3
                ? `Only ${variant.stock} left`
                : "In stock"}
        </p>
      </div>

      {product.variants.length > 1 ? (
        <fieldset>
          <legend className="mb-2 font-semibold">Option</legend>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => {
              const soldOut = !madeToOrder && v.stock === 0;
              return (
                <label
                  key={v.sku}
                  className={`relative flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-forest ${
                    v.sku === sku
                      ? "border-forest bg-forest text-paper"
                      : "border-line bg-paper-raised hover:border-ink-soft"
                  } ${soldOut ? "text-ink-soft line-through decoration-ink-soft/60" : ""}`}
                >
                  <input
                    type="radio"
                    name="variant"
                    value={v.sku}
                    checked={v.sku === sku}
                    onChange={() => {
                      setSku(v.sku);
                      setQuantity(1);
                    }}
                    className="sr-only"
                  />
                  {v.label}
                  {soldOut ? <span className="sr-only"> (sold out)</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {fields.length ? (
        <fieldset className="space-y-4 rounded-md border border-line bg-paper-raised p-4">
          <legend className="px-1 font-semibold">Personalize it</legend>
          {fields.map((f) => {
            const id = `${formId}-${f.key}`;
            const value = values[f.key] ?? "";
            const helpId = `${id}-help`;
            const errId = `${id}-err`;
            const describedBy =
              [f.helper ? helpId : null, errors[f.key] ? errId : null].filter(Boolean).join(" ") || undefined;
            return (
              <div key={f.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label htmlFor={id} className="text-[0.95rem] font-medium">
                    {f.label}
                    {f.isRequired ? <span className="text-lacquer"> *</span> : null}
                  </label>
                  {f.kind === "TEXT" ? (
                    <span
                      className={`text-xs tabular-nums ${value.length > f.maxLength ? "text-lacquer" : "text-ink-soft"}`}
                      aria-live="polite"
                    >
                      {value.length}/{f.maxLength}
                    </span>
                  ) : null}
                </div>
                {f.kind === "SELECT" ? (
                  <select
                    id={id}
                    value={value}
                    required={f.isRequired}
                    aria-invalid={Boolean(errors[f.key])}
                    aria-describedby={describedBy}
                    onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                    className="h-11 w-full rounded-md border border-line bg-paper px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
                  >
                    <option value="">Choose…</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type="text"
                    value={value}
                    required={f.isRequired}
                    maxLength={f.maxLength}
                    aria-invalid={Boolean(errors[f.key])}
                    aria-describedby={describedBy}
                    onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                    onBlur={() => errors[f.key] && setErrors(validate(fields, values))}
                    className="h-11 w-full rounded-md border border-line bg-paper px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
                  />
                )}
                {f.helper ? (
                  <p id={helpId} className="mt-1 text-sm text-ink-soft">
                    {f.helper}
                  </p>
                ) : null}
                {errors[f.key] ? (
                  <p id={errId} role="alert" className="mt-1 text-sm text-lacquer">
                    {errors[f.key]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <div className="flex items-stretch gap-3">
        <div
          className="flex h-12 items-center rounded-full border border-line bg-paper-raised"
          role="group"
          aria-label="Quantity"
        >
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1 || !inStock}
            aria-label="Decrease quantity"
            className="grid size-12 place-items-center rounded-full disabled:opacity-40"
          >
            <MinusIcon size={18} />
          </button>
          <output className="w-6 text-center font-semibold tabular-nums" aria-live="polite">
            {quantity}
          </output>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
            disabled={quantity >= maxQty || !inStock}
            aria-label="Increase quantity"
            className="grid size-12 place-items-center rounded-full disabled:opacity-40"
          >
            <PlusIcon size={18} />
          </button>
        </div>
        <button
          type="submit"
          disabled={!inStock}
          className="relative h-12 flex-1 overflow-hidden rounded-full bg-forest px-6 font-semibold text-paper transition-[background-color,transform] duration-200 hover:bg-forest-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-ink-soft/50"
        >
          <span
            className={`flex items-center justify-center gap-2 transition-transform duration-300 ${added ? "-translate-y-12" : ""}`}
          >
            {inStock ? "Add to cart" : "Sold out"}
          </span>
          <span
            className={`absolute inset-0 flex items-center justify-center gap-2 transition-transform duration-300 ${added ? "" : "translate-y-12"}`}
            aria-hidden="true"
          >
            <CheckIcon size={18} /> Added
          </span>
        </button>
        <WishlistButton productSlug={product.slug} productTitle={product.title} variant="inline" />
      </div>
    </form>
  );
}
