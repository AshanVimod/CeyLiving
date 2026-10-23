import type { User } from "./types";

export interface AccountLink {
  href: string;
  label: string;
}

/** Links in the header account menu: sellers get their dashboard, admins the admin panel (D-03). */
export function accountLinks(user: Pick<User, "role">): AccountLink[] {
  return [
    { href: "/account", label: "My Profile" },
    { href: "/account/orders", label: "My Orders" },
    { href: "/account/wishlist", label: "Wishlist" },
    ...(user.role === "SELLER" ? [{ href: "/seller", label: "Seller Dashboard" }] : []),
    ...(user.role === "ADMIN" ? [{ href: "/admin", label: "Admin panel" }] : []),
  ];
}
