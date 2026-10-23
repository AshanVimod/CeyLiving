"use client";

import { DISTRICTS } from "@/lib/districts";
import { savePayoutAction, updateShopAction } from "@/lib/server/actions/selling";
import type { Shop } from "@/lib/types";
import { ActionForm, FormInput, FormSelect, FormTextArea } from "../forms/action-form";

const photoUrl = (id: string) => (id ? `https://images.unsplash.com/photo-${id}` : "");

/** FR-2b: the seller's own shop profile. The server finds the shop by owner, never from this form. */
export function ShopProfileForm({ shop }: { shop: Shop }) {
  return (
    <ActionForm action={updateShopAction} submitLabel="Save shop profile">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Shop name" name="name" required maxLength={60} defaultValue={shop.name} />
        <FormInput label="Web address" name="slug" required maxLength={60} defaultValue={shop.slug} helper={`ceyliving.lk/shop/${shop.slug}. Lowercase letters, numbers and hyphens.`} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Your craft" name="craft" required maxLength={120} defaultValue={shop.craft} />
        <FormSelect label="District" name="district" options={DISTRICTS} placeholder="Choose" required defaultValue={shop.district} />
      </div>
      <FormTextArea label="Your story" name="story" required maxLength={1000} defaultValue={shop.story} helper="50 to 1,000 characters." />
      <FormInput label="A quote from you" name="quote" maxLength={160} defaultValue={shop.quote} helper="Optional. Shown on your shop page." />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Dispatch time" name="dispatchDays" required maxLength={60} defaultValue={shop.dispatchDays} helper="For example: Ships in 2 to 4 days" />
        <FormInput label="Return policy" name="returnPolicy" required maxLength={300} defaultValue={shop.returnPolicy} />
      </div>
      <fieldset className="grid gap-5 rounded-md border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 font-semibold">Logo</legend>
        <FormInput label="Photo link" name="logo.url" type="url" required defaultValue={photoUrl(shop.logo.id)} helper="https://images.unsplash.com/photo-…" />
        <FormInput label="Description" name="logo.alt" required maxLength={160} defaultValue={shop.logo.alt} />
      </fieldset>
      <fieldset className="grid gap-5 rounded-md border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 font-semibold">Banner</legend>
        <FormInput label="Photo link" name="banner.url" type="url" required defaultValue={photoUrl(shop.banner.id)} helper="A wide photo of your workshop or work." />
        <FormInput label="Description" name="banner.alt" required maxLength={160} defaultValue={shop.banner.alt} />
      </fieldset>
    </ActionForm>
  );
}

export function PayoutForm({ masked }: { masked?: string }) {
  return (
    <ActionForm action={savePayoutAction} submitLabel={masked ? "Replace payout account" : "Save payout details"} resetOnSuccess>
      {masked ? <p className="text-ink-soft">Current account: {masked}</p> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <FormInput label="Bank" name="bankName" required maxLength={60} autoComplete="off" />
        <FormInput label="Account number" name="accountNumber" required inputMode="numeric" autoComplete="off" helper="Only the last four digits are stored here." />
      </div>
    </ActionForm>
  );
}
