"use client";

import { useState } from "react";
import { DISTRICTS } from "@/lib/districts";
import { savePayoutAction, updateShopAction } from "@/lib/server/actions/selling";
import type { Photo, Shop, UploadPurpose } from "@/lib/types";
import { ActionForm, FormInput, FormSelect, FormTextArea, useFieldError } from "../forms/action-form";
import { FieldError } from "./application-fields";
import { PhotoUpload } from "./photo-upload";

/** B09: the logo or banner, uploaded here; the form sends its photo id as `<name>.id`. */
function ShopPhoto({
  name,
  purpose,
  label,
  photo,
  helper,
}: {
  name: "logo" | "banner";
  purpose: UploadPurpose;
  label: string;
  photo: Photo;
  helper: string;
}) {
  const [id, setId] = useState(photo.id);
  const error = useFieldError(`${name}.id`);
  return (
    <fieldset className="grid gap-5 rounded-md border border-line p-4 sm:grid-cols-2">
      <legend className="px-1 font-semibold">{label}</legend>
      <div>
        <PhotoUpload
          purpose={purpose}
          label={label}
          name={`${name}.id`}
          value={id}
          onChange={setId}
          invalid={Boolean(error)}
          wide={name === "banner"}
        />
        <p className="mt-2 text-sm text-ink-soft">{helper}</p>
        <FieldError error={error} />
      </div>
      <FormInput label="Description" name={`${name}.alt`} required maxLength={160} defaultValue={photo.alt} />
    </fieldset>
  );
}

/** FR-2b: the seller's own shop profile. The server finds the shop by owner, never from this form. */
export function ShopProfileForm({ shop }: { shop: Shop }) {
  return (
    <ActionForm action={updateShopAction} submitLabel="Save shop profile">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Shop name" name="name" required maxLength={60} defaultValue={shop.name} />
        <FormInput
          label="Web address"
          name="slug"
          required
          maxLength={60}
          defaultValue={shop.slug}
          helper={`ceyliving.lk/shop/${shop.slug}. Lowercase letters, numbers and hyphens.`}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Your craft" name="craft" required maxLength={120} defaultValue={shop.craft} />
        <FormSelect
          label="District"
          name="district"
          options={DISTRICTS}
          placeholder="Choose"
          required
          defaultValue={shop.district}
        />
      </div>
      <FormTextArea
        label="Your story"
        name="story"
        required
        maxLength={1000}
        defaultValue={shop.story}
        helper="50 to 1,000 characters."
      />
      <FormInput
        label="A quote from you"
        name="quote"
        maxLength={160}
        defaultValue={shop.quote}
        helper="Optional. Shown on your shop page."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput
          label="Dispatch time"
          name="dispatchDays"
          required
          maxLength={60}
          defaultValue={shop.dispatchDays}
          helper="For example: Ships in 2 to 4 days"
        />
        <FormInput
          label="Return policy"
          name="returnPolicy"
          required
          maxLength={300}
          defaultValue={shop.returnPolicy}
        />
      </div>
      <ShopPhoto name="logo" purpose="SHOP_LOGO" label="Logo" photo={shop.logo} helper="A square photo works best." />
      <ShopPhoto
        name="banner"
        purpose="SHOP_BANNER"
        label="Banner"
        photo={shop.banner}
        helper="A wide photo of your workshop or work."
      />
    </ActionForm>
  );
}

/** B11: `current` is what may be shown of the saved account. The number itself is never sent back to the browser. */
export function PayoutForm({ current }: { current?: string }) {
  return (
    <ActionForm
      action={savePayoutAction}
      submitLabel={current ? "Replace payout account" : "Save payout details"}
      resetOnSuccess
    >
      {current ? <p className="text-ink-soft">Current account: {current}</p> : null}
      <FormInput
        label="Account holder’s name"
        name="accountName"
        required
        maxLength={80}
        autoComplete="off"
        helper="Exactly as your bank has it."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Bank" name="bankName" required maxLength={60} autoComplete="off" />
        <FormInput label="Branch" name="branch" required maxLength={60} autoComplete="off" />
      </div>
      <FormInput
        label="Account number"
        name="accountNumber"
        required
        inputMode="numeric"
        autoComplete="off"
        helper="Stored encrypted. You’ll see only the last four digits; CeyLiving admins can view the full number only to make a transfer, and each view is logged."
      />
    </ActionForm>
  );
}
