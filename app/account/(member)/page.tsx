import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { DeleteAccountButton } from "@/components/account/privacy-actions";
import { ProfileForm } from "@/components/account/profile-form";
import { BadgeCheckIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { REAPPLY_WAIT_DAYS } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { signOut } from "@/lib/server/actions/session";
import { requireUser } from "@/lib/server/auth";
import { findShopByOwner } from "@/lib/server/repositories/catalogue";
import { applicationsOf } from "@/lib/server/repositories/people";
import { adminWaitingTotal } from "@/lib/server/services/admin-stats";
import type { SellerApplication, User } from "@/lib/types";

export const metadata: Metadata = { title: "My profile" };

const ROLE_LABEL = { CUSTOMER: "Customer", SELLER: "Seller", ADMIN: "Admin" } as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-paper-raised p-5">
      <h2 className="font-sans text-base font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const button = "inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold transition-colors";

function SellerCard({ user }: { user: User }) {
  const shop = findShopByOwner(user.id);
  if (!shop) return null;
  return (
    <Card title="Your shop">
      <p className="flex flex-wrap items-center gap-3">
        <span className="font-display text-xl">{shop.name}</span>
        <StatusBadge status={shop.status} />
      </p>
      {shop.status === "SUSPENDED" && shop.statusReason ? (
        <p className="mt-2 text-sm text-ink-soft">Reason: {shop.statusReason}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/seller" className={`${button} bg-forest text-paper hover:bg-forest-deep`}>
          Seller dashboard
        </Link>
        {shop.status === "ACTIVE" ? (
          <Link href={`/shop/${shop.slug}`} className={`${button} border border-ink/25 hover:border-ink`}>
            View my shop
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function ApplicationCard({ application }: { application?: SellerApplication }) {
  if (!application || application.status === "APPROVED" || application.status === "WITHDRAWN") {
    return (
      <Card title="Sell on CeyLiving">
        <p className="text-ink-soft">Make things by hand? Apply to open a shop. We review every application.</p>
        <Link href="/sell/apply" className={`${button} mt-4 border border-ink/25 hover:border-ink`}>
          Apply to sell
        </Link>
      </Card>
    );
  }
  return (
    <Card title="Your seller application">
      <p className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{application.shopName}</span>
        <StatusBadge status={application.status} />
      </p>
      <p className="mt-2 text-sm text-ink-soft">Submitted {formatDate(application.createdAt)}</p>
      {application.adminNote ? (
        <p className="mt-3 rounded-md bg-sage px-4 py-3 text-sm">
          <span className="font-semibold">Message from CeyLiving: </span>
          {application.adminNote}
        </p>
      ) : null}
      {application.status === "NEEDS_CHANGES" ? (
        <Link href="/sell/apply" className={`${button} mt-4 bg-forest text-paper hover:bg-forest-deep`}>
          Update your application
        </Link>
      ) : null}
      {application.status === "REJECTED" ? (
        <p className="mt-3 text-sm text-ink-soft">You can apply again {REAPPLY_WAIT_DAYS} days after the decision.</p>
      ) : null}
    </Card>
  );
}

function CustomerLinks() {
  const links = [
    { href: "/account/orders", title: "Orders", text: "Track deliveries and review what you bought." },
    { href: "/account/wishlist", title: "Wishlist", text: "Pieces you saved for later." },
    { href: "/account/addresses", title: "Saved addresses", text: "Faster checkout next time." },
    { href: "/account/questions", title: "My questions", text: "Questions you asked makers, and their answers." },
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {links.map((l) => (
        <li key={l.href}>
          <Link
            href={l.href}
            className="block h-full rounded-lg border border-line bg-paper-raised p-5 transition-colors hover:border-forest"
          >
            <span className="block font-semibold">{l.title}</span>
            <span className="mt-1 block text-sm text-ink-soft">{l.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Profile() {
  const user = await requireUser("/account");
  const application = applicationsOf(user.id)[0];
  return (
    <>
      <PageTitle title="My profile" />
      <div className="space-y-6">
        <section aria-label="Your details" className="rounded-lg border border-line bg-paper-raised p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <span
              className="grid size-16 shrink-0 place-items-center rounded-full bg-forest font-display text-2xl text-paper"
              aria-hidden="true"
            >
              {initials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-2xl [overflow-wrap:anywhere]">{user.name}</p>
              <p className="flex flex-wrap items-center gap-x-3 text-ink-soft">
                <span className="[overflow-wrap:anywhere]">{user.email}</span>
                {user.emailVerified ? (
                  <span className="inline-flex items-center gap-1 text-sm text-forest">
                    <BadgeCheckIcon size={15} /> Verified
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {ROLE_LABEL[user.role]}, member since {formatDate(user.createdAt)}
              </p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className={`${button} border border-ink/25 hover:border-lacquer hover:text-lacquer`}
              >
                Sign out
              </button>
            </form>
          </div>
          <div className="mt-6 border-t border-line pt-6">
            <ProfileForm name={user.name} phone={user.phone} />
          </div>
        </section>

        {user.role === "ADMIN" ? (
          <Card title="Admin">
            <p className="text-ink-soft">
              <span className="font-semibold text-ink tabular-nums">{adminWaitingTotal()}</span> items are waiting for
              review.
            </p>
            <Link href="/admin" className={`${button} mt-4 bg-forest text-paper hover:bg-forest-deep`}>
              Admin panel
            </Link>
          </Card>
        ) : null}
        {user.role === "SELLER" ? <SellerCard user={user} /> : null}
        {user.role === "CUSTOMER" ? <ApplicationCard application={application} /> : null}
        {user.role !== "ADMIN" ? <CustomerLinks /> : null}

        <Card title="Privacy">
          <p className="text-ink-soft">
            Download a copy of everything we hold about you, or delete your account (Sri Lanka PDPA).
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="/account/export" download className={`${button} border border-ink/25 hover:border-ink`}>
              Download my data
            </a>
            {user.role === "ADMIN" ? null : <DeleteAccountButton />}
          </div>
          {user.role === "SELLER" ? (
            <p className="mt-3 text-sm text-ink-soft">
              Sellers need to close their shop before deleting their account.
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
      <Profile />
    </Suspense>
  );
}
