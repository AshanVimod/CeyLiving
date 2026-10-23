"use client";

import { useState } from "react";
import { MATERIAL_LABELS, MATERIALS, STYLE_LABELS, STYLES } from "@/lib/catalogue";
import { PRODUCT_LIMITS as L } from "@/lib/config";
import { categories } from "@/lib/data/categories";
import { saveProductAction } from "@/lib/server/actions/selling";
import type { Product } from "@/lib/types";
import { ActionForm } from "../forms/action-form";
import { input, Labeled } from "./product-form-fields";
import { rows, toInitial, type CustomRow, type ImageRow, type Row, type VariantRow } from "./product-form-model";
import { CustomizationRows, PhotoRows, VariantRows } from "./product-form-rows";

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
    setF((s) => ({
      ...s,
      [key]: (s[key] as Row<T>[]).map((r) => (r.key === rowKey ? { ...r, value: { ...r.value, ...patch } } : r)),
    }));
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
        <button
          type="submit"
          name="intent"
          value="draft"
          className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink"
        >
          Save as draft
        </button>
      }
    >
      <input type="hidden" name="payload" value={payload} />
      {product ? <input type="hidden" name="productId" value={product.id} /> : null}

      <Labeled label="Title" name="title" required>
        <input
          name="title"
          className={input}
          value={f.title}
          maxLength={L.titleMax}
          onChange={(e) => set("title", e.target.value)}
        />
      </Labeled>
      <div className="grid gap-5 sm:grid-cols-2">
        <Labeled label="Category" name="categorySlug" required>
          <select
            name="categorySlug"
            className={input}
            value={f.categorySlug}
            onChange={(e) => set("categorySlug", e.target.value)}
          >
            <option value="">Choose</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Subcategory" name="subcategory">
          <input
            name="subcategory"
            className={input}
            value={f.subcategory}
            maxLength={60}
            onChange={(e) => set("subcategory", e.target.value)}
          />
        </Labeled>
      </div>
      <Labeled label={`Description (at least ${L.descriptionMin} characters)`} name="description" required>
        <textarea
          name="description"
          className={`${input} min-h-36 py-3`}
          value={f.description}
          maxLength={L.descriptionMax}
          onChange={(e) => set("description", e.target.value)}
        />
      </Labeled>

      <fieldset>
        <legend className="mb-2 font-medium">Materials</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {MATERIALS.map((m) => (
            <label key={m} className="flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                className="size-[18px] accent-forest"
                checked={f.materials.includes(m)}
                onChange={() => set("materials", toggle(f.materials, m))}
              />
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
              <input
                type="checkbox"
                className="size-[18px] accent-forest"
                checked={f.styles.includes(s)}
                onChange={() => set("styles", toggle(f.styles, s))}
              />
              {STYLE_LABELS[s]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2">
        <Labeled label="Materials in your words" name="materialNote">
          <input
            name="materialNote"
            className={input}
            value={f.materialNote}
            maxLength={160}
            onChange={(e) => set("materialNote", e.target.value)}
          />
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
              <input
                type="radio"
                name="type"
                className="size-[18px] accent-forest"
                checked={f.type === t}
                onChange={() => set("type", t)}
              />
              {t === "READY_TO_SHIP" ? "Ready to ship" : "Made to order"}
            </label>
          ))}
        </div>
        {f.type === "MADE_TO_ORDER" ? (
          <div className="mt-3 max-w-xs">
            <Labeled label="Processing time (days)" name="processingDays" required>
              <input
                name="processingDays"
                inputMode="numeric"
                className={input}
                value={f.processingDays}
                onChange={(e) => set("processingDays", e.target.value)}
              />
            </Labeled>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-6">
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              className="size-[18px] accent-forest"
              checked={f.isHeritage}
              onChange={(e) => set("isHeritage", e.target.checked)}
            />
            Traditional Sri Lankan craft
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              className="size-[18px] accent-forest"
              checked={f.isEcoFriendly}
              onChange={(e) => set("isEcoFriendly", e.target.checked)}
            />
            Eco-friendly
          </label>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Labeled label="Dimensions" name="dimensions">
          <input
            name="dimensions"
            className={input}
            value={f.dimensions}
            maxLength={120}
            onChange={(e) => set("dimensions", e.target.value)}
          />
        </Labeled>
        <Labeled label="Care instructions" name="care">
          <input
            name="care"
            className={input}
            value={f.care}
            maxLength={400}
            onChange={(e) => set("care", e.target.value)}
          />
        </Labeled>
      </div>

      <PhotoRows
        items={f.images}
        onChange={(rowKey, patch) => updateRow<ImageRow>("images", rowKey, patch)}
        onRemove={(rowKey) => removeRow("images", rowKey)}
        onAdd={() => set("images", [...f.images, ...rows([{ url: "", alt: "" }])])}
      />

      <VariantRows
        items={f.variants}
        onChange={(rowKey, patch) => updateRow<VariantRow>("variants", rowKey, patch)}
        onRemove={(rowKey) => removeRow("variants", rowKey)}
        onAdd={() => set("variants", [...f.variants, ...rows([{ label: "", price: "", compareAt: "", stock: "1" }])])}
      />

      <CustomizationRows
        items={f.customization}
        onChange={(rowKey, patch) => updateRow<CustomRow>("customization", rowKey, patch)}
        onRemove={(rowKey) => removeRow("customization", rowKey)}
        onAdd={() =>
          set("customization", [
            ...f.customization,
            ...rows<CustomRow>([
              { label: "", kind: "TEXT", options: "", maxLength: "30", isRequired: false, helper: "" },
            ]),
          ])
        }
      />
    </ActionForm>
  );
}
