import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/session";
import { HeaderActions } from "./header-actions";
import { HeaderAuthView } from "./header-auth-view";

const base = { emailVerified: true, postingRestriction: "NONE" as const, createdAt: "2026-01-01T00:00:00.000Z" };
const customer: Session = {
  user: { ...base, id: "user_customer", name: "Anushka Perera", email: "anushka@example.lk", role: "CUSTOMER" },
};
const seller: Session = {
  user: { ...base, id: "user_seller", name: "Ruwan Wijesuriya", email: "ruwan@example.lk", role: "SELLER" },
};
const signOut = vi.fn(async () => {});

describe("header auth, signed out", () => {
  it("shows Login and Sign Up links to the auth pages", () => {
    render(<HeaderAuthView session={null} signOutAction={signOut} />);
    expect(screen.getByRole("link", { name: "Login" })).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("link", { name: "Sign Up" })).toHaveAttribute("href", "/register");
  });

  it("does not show the account menu", () => {
    render(<HeaderAuthView session={null} signOutAction={signOut} />);
    expect(screen.queryByRole("button", { name: /account menu/i })).not.toBeInTheDocument();
  });
});

describe("header auth, signed in", () => {
  it("hides Login and Sign Up and shows a closed account menu button", () => {
    render(<HeaderAuthView session={customer} signOutAction={signOut} />);
    expect(screen.queryByRole("link", { name: "Login" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign Up" })).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Account menu for Anushka Perera" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a menu with the customer links and no seller dashboard", async () => {
    const user = userEvent.setup();
    render(<HeaderAuthView session={customer} signOutAction={signOut} />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));

    const menu = screen.getByRole("menu", { name: "Account" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["My Profile", "My Orders", "Wishlist", "Sign out"]);
    expect(within(menu).getByRole("menuitem", { name: "My Profile" })).toHaveAttribute("href", "/account");
    expect(within(menu).getByRole("menuitem", { name: "My Orders" })).toHaveAttribute("href", "/account/orders");
    expect(within(menu).getByRole("menuitem", { name: "Wishlist" })).toHaveAttribute("href", "/account/wishlist");
    expect(within(menu).queryByRole("menuitem", { name: "Seller Dashboard" })).not.toBeInTheDocument();
  });

  it("adds Seller Dashboard for sellers", async () => {
    const user = userEvent.setup();
    render(<HeaderAuthView session={seller} signOutAction={signOut} />);
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: "Seller Dashboard" })).toHaveAttribute("href", "/seller");
  });

  it("is keyboard navigable and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<HeaderAuthView session={customer} signOutAction={signOut} />);
    const button = screen.getByRole("button", { name: /account menu/i });

    button.focus();
    await user.keyboard("{ArrowDown}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "My Profile" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "My Orders" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "My Profile" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("opens on ArrowUp with focus on the last item", async () => {
    const user = userEvent.setup();
    render(<HeaderAuthView session={customer} signOutAction={signOut} />);
    screen.getByRole("button", { name: /account menu/i }).focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <p>Outside</p>
        <HeaderAuthView session={customer} signOutAction={signOut} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("header for admins and notifications", () => {
  it("D-03 admins get an Admin panel link", async () => {
    const userEv = userEvent.setup();
    const admin: Session = {
      user: { ...base, id: "user_admin", name: "Dilani Fernando", email: "dilani@example.lk", role: "ADMIN" },
    };
    render(<HeaderAuthView session={admin} signOutAction={signOut} />);
    await userEv.click(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: "Admin panel" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("menuitem", { name: "Seller Dashboard" })).not.toBeInTheDocument();
  });

  it("FR-11 shows the bell with the unread count and opens the latest notifications", async () => {
    const userEv = userEvent.setup();
    const items = [
      {
        id: "n1",
        userId: "user_customer",
        type: "order.dispatched",
        title: "Your mask is on its way",
        href: "/account/orders/CM-1",
        createdAt: new Date().toISOString(),
      },
    ];
    render(<HeaderAuthView session={customer} signOutAction={signOut} notifications={{ items, unread: 1 }} />);
    const bell = screen.getByRole("button", { name: "Notifications, 1 unread" });
    await userEv.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Your mask is on its way/ })).toHaveAttribute(
      "href",
      "/account/orders/CM-1",
    );
    await userEv.keyboard("{Escape}");
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(bell).toHaveFocus();
  });
});

describe("wishlist and cart actions", () => {
  it("keep their routes and labels", () => {
    render(<HeaderActions />);
    expect(screen.getByRole("link", { name: "Wishlist" })).toHaveAttribute("href", "/account/wishlist");
    expect(screen.getByRole("link", { name: "Cart" })).toHaveAttribute("href", "/cart");
  });
});
