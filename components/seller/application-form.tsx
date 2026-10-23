"use client";

import Link from "next/link";
import { DISTRICTS } from "@/lib/districts";
import { submitApplicationAction } from "@/lib/server/actions/selling";
import type { SellerApplication } from "@/lib/types";
import { ActionForm, FormCheckbox, FormInput, FormSelect, FormTextArea } from "../forms/action-form";
import { BusinessFields, CategoryFields, PhotoFields, Section } from "./application-fields";

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
