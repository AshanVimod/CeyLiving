"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { selectCartCount, selectWishlist, useStore } from "@/lib/store";
import { BagIcon, HeartIcon } from "../ui/icons";

/** Re-triggers a short pop each time the number changes, so adding to cart is visibly confirmed. */
function useBump(value: number) {
  const [bump, setBump] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setBump(true);
    const t = window.setTimeout(() => setBump(false), 400);
    return () => window.clearTimeout(t);
  }, [value]);
  return bump;
}

function CountBadge({ count, bump }: { count: number; bump: boolean }) {
  if (count === 0) return null;
  return (
    <span
      className={`absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lacquer px-1 text-[11px] font-semibold leading-none text-paper tabular-nums ${bump ? "pop" : ""}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const iconLink =
  "relative grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-sage active:bg-line/60";

export function HeaderActions() {
  const cartCount = useStore(selectCartCount);
  const wishCount = useStore((s) => selectWishlist(s).length);
  const cartBump = useBump(cartCount);
  const wishBump = useBump(wishCount);

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/account/wishlist"
        className={`${iconLink} max-sm:hidden`}
        aria-label={wishCount ? `Wishlist, ${wishCount} saved` : "Wishlist"}
      >
        <HeartIcon />
        <CountBadge count={wishCount} bump={wishBump} />
      </Link>
      <Link href="/cart" className={iconLink} aria-label={cartCount ? `Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}` : "Cart"}>
        <BagIcon />
        <CountBadge count={cartCount} bump={cartBump} />
      </Link>
    </div>
  );
}
