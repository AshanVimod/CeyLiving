"use client";

import { useState } from "react";
import { categories } from "@/lib/data/categories";
import type { BusinessType, SellerApplication } from "@/lib/types";
import { MAX_APPLICATION_CATEGORIES } from "@/lib/validation/application";
import { FormInput, useFieldErrorUnder } from "../forms/action-form";

// Field groups of the shop application form (FR-2a), kept apart so each file stays small (CS-02).

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-5 border-t border-line pt-6">
      <legend className="float-left mb-1 w-full font-sans text-lg font-semibold">{title}</legend>
      {description ? <p className="clear-both text-sm text-ink-soft">{description}</p> : null}
      <div className="clear-both space-y-5">{children}</div>
    </fieldset>
  );
}

export function FieldError({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm text-lacquer">
      {error}
    </p>
  ) : null;
}

export function BusinessFields({ existing }: { existing?: SellerApplication }) {
  const [type, setType] = useState<BusinessType>(existing?.businessType ?? "INDIVIDUAL");
  const error = useFieldErrorUnder("businessType");
  const options: { value: BusinessType; label: string; helper: string }[] = [
    { value: "INDIVIDUAL", label: "An individual maker", helper: "You make and sell your own work." },
    { value: "REGISTERED_BUSINESS", label: "A registered business", helper: "Your workshop is a registered business." },
  ];
  return (
    <>
      <div role="radiogroup" aria-labelledby="business-type-label" aria-invalid={Boolean(error)}>
        <p id="business-type-label" className="mb-2 text-[0.95rem] font-medium">
          You sell as <span className="text-lacquer">*</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-paper-raised p-4 has-[:checked]:border-forest has-[:checked]:bg-sage"
            >
              <input
                type="radio"
                name="businessType"
                value={o.value}
                checked={type === o.value}
                onChange={() => setType(o.value)}
                className="mt-1 size-[18px] shrink-0 accent-forest"
              />
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-sm text-ink-soft">{o.helper}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldError error={error} />
      </div>
      {type === "REGISTERED_BUSINESS" ? (
        <FormInput
          label="Business registration number"
          name="businessRegNo"
          maxLength={30}
          defaultValue={existing?.businessRegNo}
          helper="Optional. As shown on your business registration certificate."
        />
      ) : null}
    </>
  );
}

export function CategoryFields({ initial }: { initial: string[] }) {
  const [chosen, setChosen] = useState<string[]>(initial);
  const error = useFieldErrorUnder("categorySlugs");
  const full = chosen.length >= MAX_APPLICATION_CATEGORIES;
  const toggle = (slug: string) =>
    setChosen((list) => (list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]));
  return (
    <fieldset aria-describedby="categories-help">
      <legend className="mb-1.5 text-[0.95rem] font-medium">
        Categories you plan to sell in <span className="text-lacquer">*</span>
      </legend>
      <p id="categories-help" className="mb-3 text-sm text-ink-soft">
        Choose 1 to {MAX_APPLICATION_CATEGORIES}. {chosen.length} chosen.
      </p>
      <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
        {categories.map((c) => {
          const checked = chosen.includes(c.slug);
          return (
            <label key={c.slug} className="flex min-h-10 items-center gap-2 has-[:disabled]:text-ink-soft">
              <input
                type="checkbox"
                name="categorySlugs"
                value={c.slug}
                checked={checked}
                disabled={!checked && full}
                onChange={() => toggle(c.slug)}
                aria-invalid={Boolean(error)}
                className="size-[18px] accent-forest"
              />
              {c.name}
            </label>
          );
        })}
      </div>
      <FieldError error={error} />
    </fieldset>
  );
}

export function PhotoFields({ initial }: { initial: string[] }) {
  const error = useFieldErrorUnder("workPhotoUrls");
  return (
    <fieldset>
      <legend className="mb-1.5 text-[0.95rem] font-medium">
        Photos of your work <span className="text-lacquer">*</span>
      </legend>
      <p id="photos-help" className="mb-3 text-sm text-ink-soft">
        3 to 6 photo links starting with https://images.unsplash.com/photo-. Photo uploads arrive with real storage.
      </p>
      <div className="grid gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <label key={i} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-ink-soft">Photo {i + 1}</span>
            <input
              name="workPhotoUrls"
              type="url"
              inputMode="url"
              defaultValue={initial[i] ?? ""}
              aria-describedby="photos-help"
              aria-invalid={Boolean(error)}
              className="h-11 w-full rounded-md border border-line bg-paper-raised px-3 focus:border-forest focus:outline-none aria-[invalid=true]:border-lacquer"
            />
          </label>
        ))}
      </div>
      <FieldError error={error} />
    </fieldset>
  );
}
