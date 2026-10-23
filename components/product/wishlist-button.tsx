"use client";

import { useState } from "react";
import { selectWishlist, toggleWishlist, useStore } from "@/lib/store";
import { HeartIcon } from "../ui/icons";
import { toast } from "../ui/toaster";

interface WishlistButtonProps {
  productSlug: string;
  productTitle: string;
  variant?: "overlay" | "inline";
}

export function WishlistButton({ productSlug, productTitle, variant = "overlay" }: WishlistButtonProps) {
  const saved = useStore((s) => selectWishlist(s).includes(productSlug));
  const [pop, setPop] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const nowSaved = toggleWishlist(productSlug);
    setPop(nowSaved);
    toast(nowSaved ? "Saved to your wishlist" : "Removed from your wishlist", nowSaved ? { label: "View", href: "/account/wishlist" } : undefined);
  }

  const label = saved ? `Remove ${productTitle} from wishlist` : `Save ${productTitle} to wishlist`;

  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        aria-label={label}
        className="grid size-12 shrink-0 place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink-soft active:scale-95"
      >
        <span className={pop ? "pop" : ""} onAnimationEnd={() => setPop(false)}>
          <HeartIcon filled={saved} className={saved ? "text-lacquer" : ""} />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={label}
      className="absolute right-2 top-2 z-10 grid size-10 place-items-center rounded-full bg-paper-raised/90 text-ink backdrop-blur-sm transition-[transform,background-color] duration-200 hover:bg-paper-raised active:scale-90"
    >
      <span className={pop ? "pop" : ""} onAnimationEnd={() => setPop(false)}>
        <HeartIcon size={18} filled={saved} className={saved ? "text-lacquer" : ""} />
      </span>
    </button>
  );
}
