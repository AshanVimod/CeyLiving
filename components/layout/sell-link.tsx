import Link from "next/link";
import { db } from "@/lib/server/db/tx";
import { applicationsOf } from "@/lib/server/repositories/people";
import { getSession } from "@/lib/session";

export interface SellLinkTarget {
  href: string;
  label: string;
}

/** FR-2a: customers open a shop before they can sell; applicants follow their application; sellers post items. */
export const OPEN_A_SHOP: SellLinkTarget = { href: "/sell", label: "Open a shop" };

export async function sellLinkTarget(): Promise<SellLinkTarget | null> {
  const session = await getSession();
  if (!session) return OPEN_A_SHOP;
  const { user } = session;
  if (user.role === "ADMIN") return null;
  if (user.role === "SELLER") return { href: "/seller/products/new", label: "Post an item" };
  const open = (await applicationsOf(db, user.id)).some((a) => a.status === "PENDING" || a.status === "NEEDS_CHANGES");
  return open ? { href: "/sell/apply", label: "My shop application" } : OPEN_A_SHOP;
}

/** The selling link in the header and phone menu, chosen per role on the server. */
export async function SellLink({ className }: { className: string }) {
  const target = await sellLinkTarget();
  return target ? <SellLinkView target={target} className={className} /> : null;
}

export function SellLinkView({ target, className }: { target: SellLinkTarget; className: string }) {
  return (
    <Link href={target.href} className={className}>
      {target.label}
    </Link>
  );
}
