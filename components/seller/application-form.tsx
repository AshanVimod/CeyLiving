"use client";

import Link from "next/link";
import { categories } from "@/lib/data/categories";
import { DISTRICTS } from "@/lib/districts";
import { submitApplicationAction } from "@/lib/server/actions/selling";
import type { SellerApplication } from "@/lib/types";
import {
  ActionForm,
  FormCheckbox,
  FormInput,
  FormSelect,
  FormTextArea,
  useFieldErrorUnder,
} from "../forms/action-form";

const categoryOptions = categories.map((c) => ({ value: c.slug, label: c.name }));

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
      {error ? (
        <p role="alert" className="mt-2 text-sm text-lacquer">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** FR-2a: apply to sell. Every field is validated again on the server. */
export function ApplicationForm({ existing, defaultPhone }: { existing?: SellerApplication; defaultPhone?: string }) {
  return (
    <ActionForm
      action={submitApplicationAction}
      submitLabel={existing ? "Resubmit application" : "Send application"}
      pendingLabel="Sending…"
    >
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
      <div className="grid gap-5 sm:grid-cols-2">
        <FormSelect
          label="Main category"
          name="categorySlug"
          options={categoryOptions}
          placeholder="Choose"
          required
          defaultValue={existing?.categorySlug ?? ""}
        />
        <FormSelect
          label="District"
          name="district"
          options={DISTRICTS}
          placeholder="Choose"
          required
          defaultValue={existing?.district ?? ""}
        />
      </div>
      <FormTextArea
        label="Your story"
        name="story"
        required
        maxLength={1000}
        defaultValue={existing?.story}
        helper="50 to 1,000 characters. How you learned your craft, what you make and how."
      />
      <FormInput
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        defaultValue={existing?.phone ?? defaultPhone}
        helper="Only CeyLiving staff see this."
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
    </ActionForm>
  );
}
