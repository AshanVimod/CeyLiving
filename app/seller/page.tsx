import Link from "next/link";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { CheckIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { APPROVED_ITEMS_FOR_AUTOPUBLISH } from "@/lib/config";
import { sellerContext, sellerCounts } from "@/lib/server/seller-context";
import { approvedCount } from "@/lib/server/services/products";
import { shopChecklist } from "@/lib/server/services/shops";

export const metadata = { title: "Dashboard" };

function ChecklistItem({
  done,
  title,
  text,
  href,
  action,
}: {
  done: boolean;
  title: string;
  text: string;
  href: string;
  action: string;
}) {
  return (
    <li className="flex gap-4 rounded-lg border border-line bg-paper-raised p-4">
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full border-2 ${done ? "border-forest bg-forest text-paper" : "border-line text-transparent"}`}
        aria-hidden="true"
      >
        <CheckIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {title} <span className="sr-only">{done ? "(done)" : "(to do)"}</span>
        </p>
        <p className="text-sm text-ink-soft">{text}</p>
      </div>
      {!done ? (
        <Link href={href} className="self-center text-sm font-semibold text-forest underline underline-offset-4">
          {action}
        </Link>
      ) : null}
    </li>
  );
}

async function Dashboard() {
  const { shop, db } = await sellerContext("/seller");
  const checklist = await shopChecklist(shop, db);
  const c = await sellerCounts(shop.id, shop.slug);
  const approved = await approvedCount(shop, db);
  const tiles = [
    { label: "New orders to accept", value: c.newOrders, href: "/seller/orders" },
    { label: "Questions to answer", value: c.unanswered, href: "/seller/questions" },
    { label: "Items waiting for approval", value: c.pendingItems, href: "/seller/products" },
    { label: "Reviews without a reply", value: c.unrepliedReviews, href: "/seller/reviews" },
  ];
  return (
    <>
      <PageTitle
        title="Dashboard"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={shop.status} />
            {shop.status === "SUSPENDED" ? null : (
              <Link
                href="/seller/products/new"
                className="inline-flex h-11 items-center rounded-full bg-forest px-6 font-semibold text-paper hover:bg-forest-deep"
              >
                Post a new item
              </Link>
            )}
          </div>
        }
      />
      {shop.status === "SUSPENDED" ? (
        <p role="status" className="mb-6 rounded-md bg-lacquer/10 px-4 py-3 text-lacquer">
          Your shop is suspended and hidden from customers. {shop.statusReason ? `Reason: ${shop.statusReason}` : ""}{" "}
          Open orders can still be completed.{" "}
          <Link href="/help#contact" className="font-semibold underline underline-offset-4">
            Contact us
          </Link>
        </p>
      ) : null}
      {shop.status === "DRAFT" ? (
        <section aria-labelledby="setup-h" className="mb-8">
          <h2 id="setup-h" className="mb-1 text-2xl">
            Set up your shop
          </h2>
          <p className="mb-4 text-ink-soft">Your shop goes live automatically when all three are done.</p>
          <ol className="space-y-3">
            <ChecklistItem
              done={checklist.profileComplete}
              title="Complete your shop profile"
              text="Logo, banner, story (50+ characters), district, dispatch time and return policy."
              href="/seller/shop"
              action="Edit profile"
            />
            <ChecklistItem
              done={checklist.firstItem}
              title="Post your first item"
              text={`Your first ${APPROVED_ITEMS_FOR_AUTOPUBLISH} items are checked by our team before they go on sale.`}
              href="/seller/products/new"
              action="Add an item"
            />
            <ChecklistItem
              done={checklist.payoutAdded}
              title="Add payout details"
              text="Where we send your earnings each week."
              href="/seller/shop#payout"
              action="Add details"
            />
          </ol>
        </section>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link
              href={t.href}
              className="block h-full rounded-lg border border-line bg-paper-raised p-5 transition-colors hover:border-forest"
            >
              <span className="block font-display text-4xl tabular-nums">{t.value}</span>
              <span className="mt-1 block text-ink-soft">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-ink-soft">
        {approved >= APPROVED_ITEMS_FOR_AUTOPUBLISH
          ? "New items you submit go on sale straight away."
          : `${approved} of ${APPROVED_ITEMS_FOR_AUTOPUBLISH} items approved. After that, new items publish without waiting.`}
      </p>
    </>
  );
}

export default function SellerDashboardPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
      <Dashboard />
    </Suspense>
  );
}
