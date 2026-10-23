import type { Metadata } from "next";
import { db } from "@/lib/server/db/tx";
import { Suspense } from "react";
import { AddAddressForm, DeleteAddressForm } from "@/components/account/address-forms";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { requireUser } from "@/lib/server/auth";
import { addressesOf } from "@/lib/server/repositories/people";

export const metadata: Metadata = { title: "Saved addresses" };

async function Addresses() {
  const user = await requireUser("/account/addresses");
  const addresses = await addressesOf(db, user.id);
  return (
    <>
      <PageTitle title="Saved addresses" description="Used to fill in checkout. Only you can see them." />
      {addresses.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-lg border border-line bg-paper-raised p-5">
              <p className="font-semibold">{a.label}</p>
              <address className="mt-2 not-italic text-ink-soft [overflow-wrap:anywhere]">
                {a.recipientName}
                <br />
                {a.line1}
                {a.line2 ? (
                  <>
                    <br />
                    {a.line2}
                  </>
                ) : null}
                <br />
                {a.city}, {a.district} {a.postalCode}
                <br />
                {a.phone}
              </address>
              <div className="mt-4">
                <DeleteAddressForm addressId={a.id} label={a.label} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No saved addresses" text="Add one below and it will be ready at checkout." />
      )}
      <section aria-labelledby="add-address" className="mt-10 rounded-lg border border-line bg-paper-raised p-5 sm:p-6">
        <h2 id="add-address" className="mb-5 text-2xl">
          Add an address
        </h2>
        <AddAddressForm />
      </section>
    </>
  );
}

export default function AddressesPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
      <Addresses />
    </Suspense>
  );
}
