"use client";

import { PRODUCT_LIMITS as L } from "@/lib/config";
import { PlusIcon } from "../ui/icons";
import { FieldError, input, smallButton } from "./product-form-fields";
import type { CustomRow, ImageRow, Row, VariantRow } from "./product-form-model";

// The item editor's repeating sections (FR-2c; RULE-P3 limits). The form owns the rows; these render them.

interface RowsProps<T> {
  items: Row<T>[];
  onChange: (rowKey: number, patch: Partial<T>) => void;
  onRemove: (rowKey: number) => void;
  onAdd: () => void;
}

/** Photos: 1 to 8 links, each with a description. */
export function PhotoRows({ items, onChange, onRemove, onAdd }: RowsProps<ImageRow>) {
  return (
    <fieldset className="rounded-md border border-line p-4">
      <legend className="px-1 font-semibold">Photos (1 to {L.maxImages})</legend>
      <p className="mb-3 text-sm text-ink-soft">
        Links starting with https://images.unsplash.com/photo-. The first photo is the main one. Describe each photo for
        screen readers.
      </p>
      <FieldError name="images" />
      <ul className="space-y-3">
        {items.map((r, i) => (
          <li key={r.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <div>
              <input
                aria-label={`Photo ${i + 1} link`}
                name={`images.${i}.url`}
                className={input}
                value={r.value.url}
                onChange={(e) => onChange(r.key, { url: e.target.value })}
              />
              <FieldError name={`images.${i}.url`} />
            </div>
            <div>
              <input
                aria-label={`Photo ${i + 1} description`}
                name={`images.${i}.alt`}
                className={input}
                value={r.value.alt}
                maxLength={160}
                onChange={(e) => onChange(r.key, { alt: e.target.value })}
              />
              <FieldError name={`images.${i}.alt`} />
            </div>
            <button
              type="button"
              className={smallButton}
              onClick={() => onRemove(r.key)}
              aria-label={`Remove photo ${i + 1}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {items.length < L.maxImages ? (
        <button type="button" className={`${smallButton} mt-3`} onClick={onAdd}>
          <PlusIcon size={16} /> Add photo
        </button>
      ) : null}
    </fieldset>
  );
}

/** Options and prices: label, price, optional original price and stock. */
export function VariantRows({ items, onChange, onRemove, onAdd }: RowsProps<VariantRow>) {
  return (
    <fieldset className="rounded-md border border-line p-4">
      <legend className="px-1 font-semibold">Options and prices</legend>
      <p className="mb-3 text-sm text-ink-soft">Prices in rupees. For made-to-order items, stock is ignored.</p>
      <FieldError name="variants" />
      <ul className="space-y-4">
        {items.map((r, i) => (
          <li key={r.key} className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_0.8fr_auto] sm:items-start">
            {(["label", "price", "compareAt", "stock"] as const).map((k) => (
              <div key={k}>
                <input
                  aria-label={`Option ${i + 1} ${k === "compareAt" ? "original price (optional)" : k}`}
                  placeholder={
                    k === "label"
                      ? "Option name"
                      : k === "price"
                        ? "Price"
                        : k === "compareAt"
                          ? "Was (optional)"
                          : "Stock"
                  }
                  name={`variants.${i}.${k}`}
                  inputMode={k === "label" ? undefined : "decimal"}
                  className={input}
                  value={r.value[k]}
                  onChange={(e) => onChange(r.key, { [k]: e.target.value })}
                />
                <FieldError name={`variants.${i}.${k}`} />
              </div>
            ))}
            <button
              type="button"
              className={smallButton}
              onClick={() => onRemove(r.key)}
              aria-label={`Remove option ${i + 1}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {items.length < L.maxVariants ? (
        <button type="button" className={`${smallButton} mt-3`} onClick={onAdd}>
          <PlusIcon size={16} /> Add option
        </button>
      ) : null}
    </fieldset>
  );
}

/** Personalization fields the buyer fills in (up to 5). */
export function CustomizationRows({ items, onChange, onRemove, onAdd }: RowsProps<CustomRow>) {
  return (
    <fieldset className="rounded-md border border-line p-4">
      <legend className="px-1 font-semibold">Personalization (optional, up to {L.maxCustomFields})</legend>
      <FieldError name="customization" under />
      <ul className="space-y-4">
        {items.map((r, i) => (
          <li key={r.key} className="grid gap-2 rounded-md bg-sage/50 p-3 sm:grid-cols-2">
            <input
              aria-label={`Field ${i + 1} label`}
              placeholder="What should the customer enter?"
              name={`customization.${i}.label`}
              className={input}
              value={r.value.label}
              onChange={(e) => onChange(r.key, { label: e.target.value })}
            />
            <select
              aria-label={`Field ${i + 1} type`}
              className={input}
              value={r.value.kind}
              onChange={(e) => onChange(r.key, { kind: e.target.value as CustomRow["kind"] })}
            >
              <option value="TEXT">Text</option>
              <option value="SELECT">Choice from a list</option>
            </select>
            {r.value.kind === "SELECT" ? (
              <input
                aria-label={`Field ${i + 1} choices`}
                placeholder="Choices, comma separated"
                className={input}
                value={r.value.options}
                onChange={(e) => onChange(r.key, { options: e.target.value })}
              />
            ) : (
              <input
                aria-label={`Field ${i + 1} maximum length`}
                inputMode="numeric"
                placeholder="Max characters"
                className={input}
                value={r.value.maxLength}
                onChange={(e) => onChange(r.key, { maxLength: e.target.value })}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex min-h-10 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-[18px] accent-forest"
                  checked={r.value.isRequired}
                  onChange={(e) => onChange(r.key, { isRequired: e.target.checked })}
                />
                Required
              </label>
              <button type="button" className={smallButton} onClick={() => onRemove(r.key)}>
                Remove field
              </button>
            </div>
          </li>
        ))}
      </ul>
      {items.length < L.maxCustomFields ? (
        <button type="button" className={`${smallButton} mt-3`} onClick={onAdd}>
          <PlusIcon size={16} /> Add personalization field
        </button>
      ) : null}
    </fieldset>
  );
}
