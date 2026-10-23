"use client";

import { useState } from "react";
import { MATERIAL_LABELS, MATERIALS, STYLE_LABELS, STYLES } from "@/lib/catalogue";
import { PRODUCT_LIMITS as L } from "@/lib/config";
import { categories } from "@/lib/data/categories";
import { saveProductAction } from "@/lib/server/actions/selling";
import type { Material, Product, Style } from "@/lib/types";
import { ActionForm, useFieldError, useFieldErrorUnder } from "../forms/action-form";
import { PlusIcon } from "../ui/icons";

interface Row<T> {
  key: number;
  value: T;
}
type ImageRow = { url: string; alt: string };
type VariantRow = { label: string; price: string; compareAt: string; stock: string };
type CustomRow = { label: string; kind: "TEXT" | "SELECT"; options: string; maxLength: string; isRequired: boolean; helper: string };

let nextKey = 1;
const rows = <T,>(values: T[]): Row<T>[] => values.map((value) => ({ key: nextKey++, value }));

const input = "h-11 w-full rounded-md border border-line bg-paper-raised px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer";
const smallButton = "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-ink/25 px-4 text-sm font-semibold hover:border-ink";

function FieldError({ name, under = false }: { name: string; under?: boolean }) {
  const exact = useFieldError(name);
  const nested = useFieldErrorUnder(name);
  const error = under ? nested : exact;
  return error ? (
    <p role="alert" className="mt-1 text-sm text-lacquer">
      {error}
    </p>
  ) : null;
}

function Labeled({ label, name, children, required }: { label: string; name: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.95rem] font-medium">
        {label}
        {required ? <span className="text-lacquer"> *</span> : null}
      </span>
      {children}
      <FieldError name={name} />
    </label>
  );
}

function toInitial(p?: Product) {
  const rupees = (c?: number) => (c === undefined ? "" : String(c / 100));
  return {
    title: p?.title ?? "",
    categorySlug: p?.categorySlug ?? "",
    subcategory: p?.subcategory ?? "",
    description: p?.description ?? "",
    materials: p?.materials ?? ([] as Material[]),
    materialNote: p?.materialNote ?? "",
    styles: p?.styles ?? ([] as Style[]),
    tags: p?.tags.join(", ") ?? "",
    type: p?.type ?? "READY_TO_SHIP",
    processingDays: p?.processingDays ? String(p.processingDays) : "",
    dimensions: p?.dimensions ?? "",
    care: p?.care ?? "",
    isHeritage: p?.isHeritage ?? false,
    isEcoFriendly: p?.isEcoFriendly ?? false,
    images: rows<ImageRow>(p?.images.map((i) => ({ url: `https://images.unsplash.com/photo-${i.id}`, alt: i.alt })) ?? [{ url: "", alt: "" }]),
    variants: rows<VariantRow>(p?.variants.map((v) => ({ label: v.label, price: rupees(v.priceCents), compareAt: rupees(v.compareAtPriceCents), stock: String(v.stock) })) ?? [{ label: "One size", price: "", compareAt: "", stock: "1" }]),
    customization: rows<CustomRow>(p?.customization?.map((f) => ({ label: f.label, kind: f.kind, options: f.options?.join(", ") ?? "", maxLength: String(f.maxLength), isRequired: f.isRequired, helper: f.helper ?? "" })) ?? []),
  };
}

/** FR-2c item editor. The browser only collects; every rule (RULE-P1 to P3) is checked on the server. */
export function ProductForm({ product }: { product?: Product }) {
  const [f, setF] = useState(() => toInitial(product));
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => setF((s) => ({ ...s, [key]: value }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const payload = JSON.stringify({
    ...f,
    images: f.images.map((r) => r.value).filter((i) => i.url || i.alt),
    variants: f.variants.map((r) => ({ ...r.value, compareAt: r.value.compareAt || undefined })),
    customization: f.customization.map((r) => ({ ...r.value, helper: r.value.helper || undefined })),
    processingDays: f.type === "MADE_TO_ORDER" ? f.processingDays : undefined,
  });

  function updateRow<T>(key: "images" | "variants" | "customization", rowKey: number, patch: Partial<T>) {
    setF((s) => ({ ...s, [key]: (s[key] as Row<T>[]).map((r) => (r.key === rowKey ? { ...r, value: { ...r.value, ...patch } } : r)) }));
  }
  function removeRow(key: "images" | "variants" | "customization", rowKey: number) {
    setF((s) => ({ ...s, [key]: (s[key] as Row<unknown>[]).filter((r) => r.key !== rowKey) }));
  }

  return (
    <ActionForm
      action={saveProductAction}
      submitLabel={product?.status === "ACTIVE" ? "Save and keep on sale" : "Submit for sale"}
      pendingLabel="Saving…"
      submitName="intent"
      submitValue="submit"
      extraButtons={
        <button type="submit" name="intent" value="draft" className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink">
          Save as draft
        </button>
      }
    >
      <input type="hidden" name="payload" value={payload} />
      {product ? <input type="hidden" name="productId" value={product.id} /> : null}

      <Labeled label="Title" name="title" required>
        <input name="title" className={input} value={f.title} maxLength={L.titleMax} onChange={(e) => set("title", e.target.value)} />
      </Labeled>
      <div className="grid gap-5 sm:grid-cols-2">
        <Labeled label="Category" name="categorySlug" required>
          <select name="categorySlug" className={input} value={f.categorySlug} onChange={(e) => set("categorySlug", e.target.value)}>
            <option value="">Choose</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Subcategory" name="subcategory">
          <input name="subcategory" className={input} value={f.subcategory} maxLength={60} onChange={(e) => set("subcategory", e.target.value)} />
        </Labeled>
      </div>
      <Labeled label={`Description (at least ${L.descriptionMin} characters)`} name="description" required>
        <textarea name="description" className={`${input} min-h-36 py-3`} value={f.description} maxLength={L.descriptionMax} onChange={(e) => set("description", e.target.value)} />
      </Labeled>

      <fieldset>
        <legend className="mb-2 font-medium">Materials</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {MATERIALS.map((m) => (
            <label key={m} className="flex min-h-10 items-center gap-2">
              <input type="checkbox" className="size-[18px] accent-forest" checked={f.materials.includes(m)} onChange={() => set("materials", toggle(f.materials, m))} />
              {MATERIAL_LABELS[m]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-medium">Style</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {STYLES.map((s) => (
            <label key={s} className="flex min-h-10 items-center gap-2">
              <input type="checkbox" className="size-[18px] accent-forest" checked={f.styles.includes(s)} onChange={() => set("styles", toggle(f.styles, s))} />
              {STYLE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <Labeled label="Materials in your words" name="materialNote">
          <input name="materialNote" className={input} value={f.materialNote} maxLength={160} onChange={(e) => set("materialNote", e.target.value)} />
        </Labeled>
        <Labeled label="Tags (comma separated)" name="tags">
          <input name="tags" className={input} value={f.tags} onChange={(e) => set("tags", e.target.value)} />
        </Labeled>
      </div>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 font-semibold">How it’s made</legend>
        <div className="flex flex-wrap gap-5">
          {(["READY_TO_SHIP", "MADE_TO_ORDER"] as const).map((t) => (
            <label key={t} className="flex min-h-10 items-center gap-2">
              <input type="radio" name="type" className="size-[18px] accent-forest" checked={f.type === t} onChange={() => set("type", t)} />
              {t === "READY_TO_SHIP" ? "Ready to ship" : "Made to order"}
            </label>
          ))}
        </div>
        {f.type === "MADE_TO_ORDER" ? (
          <div className="mt-3 max-w-xs">
            <Labeled label="Processing time (days)" name="processingDays" required>
              <input name="processingDays" inputMode="numeric" className={input} value={f.processingDays} onChange={(e) => set("processingDays", e.target.value)} />
            </Labeled>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-6">
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="size-[18px] accent-forest" checked={f.isHeritage} onChange={(e) => set("isHeritage", e.target.checked)} />
            Traditional Sri Lankan craft
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="size-[18px] accent-forest" checked={f.isEcoFriendly} onChange={(e) => set("isEcoFriendly", e.target.checked)} />
            Eco-friendly
          </label>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Labeled label="Dimensions" name="dimensions">
          <input name="dimensions" className={input} value={f.dimensions} maxLength={120} onChange={(e) => set("dimensions", e.target.value)} />
        </Labeled>
        <Labeled label="Care instructions" name="care">
          <input name="care" className={input} value={f.care} maxLength={400} onChange={(e) => set("care", e.target.value)} />
        </Labeled>
      </div>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 font-semibold">Photos (1 to {L.maxImages})</legend>
        <p className="mb-3 text-sm text-ink-soft">Links starting with https://images.unsplash.com/photo-. The first photo is the main one. Describe each photo for screen readers.</p>
        <FieldError name="images" />
        <ul className="space-y-3">
          {f.images.map((r, i) => (
            <li key={r.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
              <div>
                <input aria-label={`Photo ${i + 1} link`} name={`images.${i}.url`} className={input} value={r.value.url} onChange={(e) => updateRow<ImageRow>("images", r.key, { url: e.target.value })} />
                <FieldError name={`images.${i}.url`} />
              </div>
              <div>
                <input aria-label={`Photo ${i + 1} description`} name={`images.${i}.alt`} className={input} value={r.value.alt} maxLength={160} onChange={(e) => updateRow<ImageRow>("images", r.key, { alt: e.target.value })} />
                <FieldError name={`images.${i}.alt`} />
              </div>
              <button type="button" className={smallButton} onClick={() => removeRow("images", r.key)} aria-label={`Remove photo ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {f.images.length < L.maxImages ? (
          <button type="button" className={`${smallButton} mt-3`} onClick={() => set("images", [...f.images, ...rows([{ url: "", alt: "" }])])}>
            <PlusIcon size={16} /> Add photo
          </button>
        ) : null}
      </fieldset>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 font-semibold">Options and prices</legend>
        <p className="mb-3 text-sm text-ink-soft">Prices in rupees. For made-to-order items, stock is ignored.</p>
        <FieldError name="variants" />
        <ul className="space-y-4">
          {f.variants.map((r, i) => (
            <li key={r.key} className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_0.8fr_auto] sm:items-start">
              {(["label", "price", "compareAt", "stock"] as const).map((k) => (
                <div key={k}>
                  <input
                    aria-label={`Option ${i + 1} ${k === "compareAt" ? "original price (optional)" : k}`}
                    placeholder={k === "label" ? "Option name" : k === "price" ? "Price" : k === "compareAt" ? "Was (optional)" : "Stock"}
                    name={`variants.${i}.${k}`}
                    inputMode={k === "label" ? undefined : "decimal"}
                    className={input}
                    value={r.value[k]}
                    onChange={(e) => updateRow<VariantRow>("variants", r.key, { [k]: e.target.value })}
                  />
                  <FieldError name={`variants.${i}.${k}`} />
                </div>
              ))}
              <button type="button" className={smallButton} onClick={() => removeRow("variants", r.key)} aria-label={`Remove option ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {f.variants.length < L.maxVariants ? (
          <button type="button" className={`${smallButton} mt-3`} onClick={() => set("variants", [...f.variants, ...rows([{ label: "", price: "", compareAt: "", stock: "1" }])])}>
            <PlusIcon size={16} /> Add option
          </button>
        ) : null}
      </fieldset>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 font-semibold">Personalization (optional, up to {L.maxCustomFields})</legend>
        <FieldError name="customization" under />
        <ul className="space-y-4">
          {f.customization.map((r, i) => (
            <li key={r.key} className="grid gap-2 rounded-md bg-sage/50 p-3 sm:grid-cols-2">
              <input aria-label={`Field ${i + 1} label`} placeholder="What should the customer enter?" name={`customization.${i}.label`} className={input} value={r.value.label} onChange={(e) => updateRow<CustomRow>("customization", r.key, { label: e.target.value })} />
              <select aria-label={`Field ${i + 1} type`} className={input} value={r.value.kind} onChange={(e) => updateRow<CustomRow>("customization", r.key, { kind: e.target.value as CustomRow["kind"] })}>
                <option value="TEXT">Text</option>
                <option value="SELECT">Choice from a list</option>
              </select>
              {r.value.kind === "SELECT" ? (
                <input aria-label={`Field ${i + 1} choices`} placeholder="Choices, comma separated" className={input} value={r.value.options} onChange={(e) => updateRow<CustomRow>("customization", r.key, { options: e.target.value })} />
              ) : (
                <input aria-label={`Field ${i + 1} maximum length`} inputMode="numeric" placeholder="Max characters" className={input} value={r.value.maxLength} onChange={(e) => updateRow<CustomRow>("customization", r.key, { maxLength: e.target.value })} />
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-10 items-center gap-2">
                  <input type="checkbox" className="size-[18px] accent-forest" checked={r.value.isRequired} onChange={(e) => updateRow<CustomRow>("customization", r.key, { isRequired: e.target.checked })} />
                  Required
                </label>
                <button type="button" className={smallButton} onClick={() => removeRow("customization", r.key)}>
                  Remove field
                </button>
              </div>
            </li>
          ))}
        </ul>
        {f.customization.length < L.maxCustomFields ? (
          <button type="button" className={`${smallButton} mt-3`} onClick={() => set("customization", [...f.customization, ...rows<CustomRow>([{ label: "", kind: "TEXT", options: "", maxLength: "30", isRequired: false, helper: "" }])])}>
            <PlusIcon size={16} /> Add personalization field
          </button>
        ) : null}
      </fieldset>
    </ActionForm>
  );
}
