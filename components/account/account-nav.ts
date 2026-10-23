import type { NavItem } from "./section-nav";

export function accountNavItems(unreadNotifications: number): NavItem[] {
  return [
    { href: "/account", label: "Profile" },
    { href: "/account/orders", label: "Orders" },
    { href: "/account/wishlist", label: "Wishlist" },
    { href: "/account/addresses", label: "Addresses" },
    { href: "/account/questions", label: "My questions" },
    { href: "/account/requests", label: "Custom requests" },
    { href: "/account/notifications", label: "Notifications", count: unreadNotifications },
  ];
}
