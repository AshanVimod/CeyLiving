import Link from "next/link";
import type { Session } from "@/lib/session";
import { UserIcon, UserPlusIcon } from "../ui/icons";
import type { Notification } from "@/lib/types";
import { AccountMenu } from "./account-menu";
import { NotificationBell } from "./notification-bell";

const textAction =
  "inline-flex h-11 items-center gap-2 rounded-full px-3 text-[0.95rem] font-medium text-ink transition-colors hover:bg-sage active:bg-line/60";

interface HeaderAuthViewProps {
  session: Session | null;
  signOutAction: () => Promise<void>;
  notifications?: { items: Notification[]; unread: number };
}

/**
 * Signed out: Login and Sign Up (from md up; phones get them in the menu drawer).
 * Signed in: the notification bell, and the account menu from 640px (phones use the drawer's account links).
 */
export function HeaderAuthView({ session, signOutAction, notifications }: HeaderAuthViewProps) {
  if (session) {
    return (
      <div className="flex items-center gap-2">
        {notifications ? <NotificationBell items={notifications.items} unread={notifications.unread} /> : null}
        <div className="max-sm:hidden">
          <AccountMenu user={session.user} signOutAction={signOutAction} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 max-md:hidden">
      <Link href="/signin" className={textAction}>
        <UserIcon size={20} />
        Login
      </Link>
      <Link href="/register" className={textAction}>
        <UserPlusIcon size={20} />
        Sign Up
      </Link>
    </div>
  );
}

/** Keeps the auth slot's space while the session streams in, so nothing signed-out flashes. */
export function HeaderAuthPlaceholder() {
  return <span className="block size-11 max-md:hidden" aria-hidden="true" />;
}
