"use client";

import Link from "next/link";
import { useState } from "react";
import { categories } from "@/lib/data/categories";
import { DISTRICTS } from "@/lib/districts";
import { submitApplicationAction } from "@/lib/server/actions/selling";
import type { BusinessType, SellerApplication } from "@/lib/types";
import { MAX_APPLICATION_CATEGORIES } from "@/lib/validation/application";
import {
  ActionForm,
  FormCheckbox,
  FormInput,
  FormSelect,
  FormTextArea,
  useFieldErrorUnder,
} from "../forms/action-form";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-5 border-t border-line pt-6">
      <legend className="float-left mb-1 w-full font-sans text-lg font-semibold">{title}</legend>
      {description ? <p className="clear-both text-sm text-ink-soft">{description}</p> : null}
      <div className="clear-both space-y-5">{children}</div>
    </fieldset>
  );
}

function FieldError({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm text-lacquer">
      {error}
    </p>
  ) : null;
}

function BusinessFields({ existing }: { existing?: SellerApplication }) {
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

function CategoryFields({ initial }: { initial: string[] }) {
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

function PhotoFields({ initial }: { initial: string[] }) {
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

/**
 * FR-2a: a customer applies to open a shop. CeyLiving reviews it; once approved they set up the shop and sell.
 * Every field is validated again on the server.
 */
export function ApplicationForm({
  existing,
  defaultName,
  defaultPhone,
}: {
  existing?: SellerApplication;
  defaultName?: string;
  defaultPhone?: string;
}) {
  const address = existing?.address;
  return (
    <ActionForm
      action={submitApplicationAction}
      submitLabel={existing ? "Resubmit application" : "Send application"}
      pendingLabel="Sending…"
      className="space-y-8"
    >
      <Section title="About you" description="Only CeyLiving staff see these details.">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            label="Full name"
            name="applicantName"
            autoComplete="name"
            required
            maxLength={80}
            defaultValue={existing?.applicantName ?? defaultName}
          />
          <FormInput
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            defaultValue={existing?.phone ?? defaultPhone}
            helper="For example 0771234567"
          />
        </div>
        <BusinessFields existing={existing} />
      </Section>

      <Section title="Your shop">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            label="Proposed shop name"
            name="shopName"
            required
            maxLength={60}
            defaultValue={existing?.shopName}
          />
          <FormInput
            label="Your craft"
            name="craft"
            required
            maxLength={120}
            defaultValue={existing?.craft}
            helper="For example: hand-turned lacquerware"
          />
        </div>
        <CategoryFields initial={existing?.categorySlugs ?? []} />
        <FormTextArea
          label="Your story"
          name="story"
          required
          maxLength={1000}
          defaultValue={existing?.story}
          helper="50 to 1,000 characters. How you learned your craft, what you make and how."
        />
        <PhotoFields initial={existing?.workPhotoUrls ?? []} />
        <FormInput
          label="Social media or website"
          name="socialUrl"
          type="url"
          inputMode="url"
          defaultValue={existing?.socialUrl}
          helper="Optional. https:// address"
        />
      </Section>

      <Section
        title="Shop address"
        description="Where your orders are sent from. Only CeyLiving staff see the full address; buyers see the district."
      >
        <FormInput
          label="Address line 1"
          name="address.line1"
          autoComplete="address-line1"
          required
          maxLength={120}
          defaultValue={address?.line1}
        />
        <FormInput
          label="Address line 2"
          name="address.line2"
          autoComplete="address-line2"
          maxLength={120}
          defaultValue={address?.line2}
          helper="Optional"
        />
        <div className="grid gap-5 sm:grid-cols-3">
          <FormInput
            label="City or town"
            name="address.city"
            autoComplete="address-level2"
            required
            maxLength={60}
            defaultValue={address?.city}
          />
          <FormSelect
            label="District"
            name="address.district"
            options={DISTRICTS}
            placeholder="Choose"
            required
            defaultValue={address?.district ?? ""}
          />
          <FormInput
            label="Postal code"
            name="address.postalCode"
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
            defaultValue={address?.postalCode}
            helper="Optional"
          />
        </div>
      </Section>

      <div className="border-t border-line pt-6">
        <FormCheckbox
          name="acceptTerms"
          label={
            <>
              I make this work myself and accept the{" "}
              <Link href="/sell#fees" className="font-semibold text-forest underline underline-offset-4">
                seller terms
              </Link>{" "}
              and the{" "}
              <Link href="/sell" className="font-semibold text-forest underline underline-offset-4">
                list of items that can’t be sold
              </Link>
              .
            </>
          }
        />
      </div>
    </ActionForm>
  );
}
