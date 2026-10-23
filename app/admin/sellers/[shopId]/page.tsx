import Link from "next/link";
import { db } from "@/lib/server/db/tx";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { DataTable, Td } from "@/components/admin/data-table";
import { ShopDecisions } from "@/components/admin/shop-decisions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { findShopById, productsOfShop } from "@/lib/server/repositories/catalogue";
import { findUserById, listAuditLog, listUsers } from "@/lib/server/repositories/people";

export const metadata = { title: "Shop" };

async function Shop({ params }: { params: PageProps<"/admin/sellers/[shopId]">["params"] }) {
  await requireRole(["ADMIN"], "/admin/sellers");
  const { shopId } = await params;
  const shop = await findShopById(db, shopId);
  if (!shop) notFound();
  const owner = await findUserById(db, shop.ownerId);
  const items = await productsOfShop(db, shop.id);
  const history = (await listAuditLog(db)).filter((a) => a.targetId === shop.id);
  const userNames = new Map((await listUsers(db)).map((u) => [u.id, u.name]));
  return (
    <>
      <p className="mb-3">
        <Link href="/admin/sellers" className="text-sm font-semibold text-forest underline underline-offset-4">
          All sellers
        </Link>
      </p>
      <PageTitle
        title={shop.name}
        description={`${owner?.name ?? "Unknown owner"} (${owner?.email ?? ""}), ${shop.district}. Created ${formatDate(shop.createdAt)}.`}
        action={<StatusBadge status={shop.status} />}
      />
      {shop.statusReason ? (
        <p className="mb-6 rounded-md bg-sage px-4 py-3">Reason on record: {shop.statusReason}</p>
      ) : null}
      <ShopDecisions shopId={shop.id} name={shop.name} status={shop.status} isVerified={shop.isVerified} />
      {shop.status === "ACTIVE" ? (
        <p className="mt-4">
          <Link href={`/shop/${shop.slug}`} className="text-sm font-semibold text-forest underline underline-offset-4">
            View the public shop page
          </Link>
        </p>
      ) : null}
      <h2 className="mt-10 mb-4 text-2xl">Items ({items.length})</h2>
      <DataTable caption={`Items of ${shop.name}`} headers={["Item", "Status", "Updated"]}>
        {items.map((p) => (
          <tr key={p.id}>
            <Td>{p.title}</Td>
            <Td>
              <StatusBadge status={p.status} />
            </Td>
            <Td>{formatDate(p.updatedAt)}</Td>
          </tr>
        ))}
      </DataTable>
      <h2 className="mt-10 mb-4 text-2xl">History</h2>
      {history.length ? (
        <ul className="space-y-2 text-[0.95rem]">
          {history.map((h) => (
            <li key={h.id} className="rounded-md border border-line bg-paper-raised px-4 py-3">
              <span className="font-semibold">{h.action}</span> by {userNames.get(h.actorId) ?? h.actorId},{" "}
              {formatDate(h.createdAt)}
              {h.reason ? <span className="block text-ink-soft">Reason: {h.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-soft">No admin actions on this shop yet.</p>
      )}
    </>
  );
}

export default function AdminShopPage(props: PageProps<"/admin/sellers/[shopId]">) {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-lg" aria-busy="true" />}>
      <Shop params={props.params} />
    </Suspense>
  );
}
