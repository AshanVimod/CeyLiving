import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageTitle } from "@/components/account/area-shell";
import { DataTable, FilterLinks, Td } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { requireRole } from "@/lib/server/auth";
import { listUsers } from "@/lib/server/repositories/people";

export const metadata = { title: "Users" };

const ROLES = ["ALL", "CUSTOMER", "SELLER", "ADMIN", "RESTRICTED"] as const;

async function Users({ searchParams }: { searchParams: PageProps<"/admin/users">["searchParams"] }) {
  await requireRole(["ADMIN"], "/admin/users");
  const sp = await searchParams;
  const role = ROLES.find((r) => r === sp.role) ?? "ALL";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";
  const users = listUsers()
    .filter((u) => role === "ALL" || (role === "RESTRICTED" ? u.postingRestriction !== "NONE" : u.role === role))
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  return (
    <>
      <form role="search" className="mb-5 flex max-w-md gap-2" action="/admin/users">
        <label htmlFor="user-q" className="sr-only">
          Find a user by name or email
        </label>
        <input id="user-q" name="q" type="search" defaultValue={q} placeholder="Name or email" className="h-11 flex-1 rounded-full border border-line bg-paper-raised px-4 focus:border-forest focus:outline-none" />
        <input type="hidden" name="role" value={role} />
        <button type="submit" className="h-11 rounded-full bg-forest px-5 text-sm font-semibold text-paper">
          Find
        </button>
      </form>
      <FilterLinks current={role} items={ROLES.map((r) => ({ value: r, label: r === "ALL" ? "All" : r.charAt(0) + r.slice(1).toLowerCase(), href: `/admin/users?role=${r}${q ? `&q=${encodeURIComponent(q)}` : ""}` }))} />
      {users.length ? (
        <DataTable caption="Users" headers={["Name", "Email", "Role", "Posting", "Joined"]}>
          {users.map((u) => (
            <tr key={u.id}>
              <Td>
                <Link href={`/admin/users/${u.id}`} className="font-semibold text-forest underline underline-offset-4">
                  {u.name}
                </Link>
              </Td>
              <Td className="[overflow-wrap:anywhere]">{u.email}</Td>
              <Td>{u.role.charAt(0) + u.role.slice(1).toLowerCase()}</Td>
              <Td>
                <StatusBadge status={u.postingRestriction} />
              </Td>
              <Td>{formatDate(u.createdAt)}</Td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState title="No users found" text="Try another name or filter." />
      )}
    </>
  );
}

export default function AdminUsersPage(props: PageProps<"/admin/users">) {
  return (
    <>
      <PageTitle title="Users" description="Find people, see their history, and mute or ban posting." />
      <Suspense fallback={<div className="skeleton h-64 rounded-lg" aria-busy="true" />}>
        <Users searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
