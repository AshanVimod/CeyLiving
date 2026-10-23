import Link from "next/link";
import { signOut } from "@/lib/server/actions/session";
import { getSession } from "@/lib/session";
import { accountLinks } from "@/lib/account-links";
import { myNotifications } from "@/lib/server/services/notifications";
import { HeaderAuthView } from "./header-auth-view";

export async function HeaderAuth() {
  const session = await getSession();
  const notifications = session ? await myNotifications(session.user, 5) : undefined;
  return <HeaderAuthView session={session} signOutAction={signOut} notifications={notifications} />;
}

const drawerLink = "flex min-h-12 items-center rounded-md px-2 text-lg hover:bg-sage";

/** Account entries for the phone menu drawer. */
export async function MobileAccountLinks() {
  const session = await getSession();
  if (!session) {
    return (
      <>
        <li>
          <Link href="/signin" className={drawerLink}>
            Login
          </Link>
        </li>
        <li>
          <Link href="/register" className={drawerLink}>
            Sign Up
          </Link>
        </li>
      </>
    );
  }
  return (
    <>
      {accountLinks(session.user)
        .filter((l) => l.href !== "/account/wishlist")
        .map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={drawerLink}>
              {l.label}
            </Link>
          </li>
        ))}
      <li>
        <form action={signOut}>
          <button type="submit" className={`${drawerLink} w-full text-left`}>
            Sign out
          </button>
        </form>
      </li>
    </>
  );
}
