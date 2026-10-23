"use client";

import { useSyncExternalStore } from "react";
import { MAX_CART_QUANTITY } from "./config";

// Browser-only cart and wishlist for guests. The API cart (T09) replaces this and merges it on sign-in.

export interface CartLine {
  key: string;
  productSlug: string;
  sku: string;
  quantity: number;
  customization: Record<string, string>;
}

interface StoreState {
  cart: CartLine[];
  wishlist: string[];
}

const STORAGE_KEY = "ceyliving:v1";
const EMPTY: StoreState = { cart: [], wishlist: [] };
const listeners = new Set<() => void>();
let state: StoreState = EMPTY;
let loaded = false;

function load(): StoreState {
  if (loaded) return state;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoreState>;
      state = {
        cart: Array.isArray(parsed.cart) ? parsed.cart : [],
        wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
      };
    }
  } catch {
    state = EMPTY;
  }
  return state;
}

function commit(next: StoreState) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the cart still works for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      loaded = false;
      load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStore<T>(select: (s: StoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(load()),
    () => select(EMPTY),
  );
}

function lineKey(productSlug: string, sku: string, customization: Record<string, string>) {
  return `${productSlug}|${sku}|${JSON.stringify(customization)}`;
}

export function addToCart(productSlug: string, sku: string, quantity: number, customization: Record<string, string>) {
  const current = load();
  const key = lineKey(productSlug, sku, customization);
  const existing = current.cart.find((l) => l.key === key);
  const cart = existing
    ? current.cart.map((l) =>
        l.key === key ? { ...l, quantity: Math.min(MAX_CART_QUANTITY, l.quantity + quantity) } : l,
      )
    : [...current.cart, { key, productSlug, sku, quantity: Math.min(MAX_CART_QUANTITY, quantity), customization }];
  commit({ ...current, cart });
}

export function setQuantity(key: string, quantity: number) {
  const current = load();
  const q = Math.max(1, Math.min(MAX_CART_QUANTITY, quantity));
  commit({ ...current, cart: current.cart.map((l) => (l.key === key ? { ...l, quantity: q } : l)) });
}

export function removeLine(key: string) {
  const current = load();
  commit({ ...current, cart: current.cart.filter((l) => l.key !== key) });
}

export function toggleWishlist(productSlug: string): boolean {
  const current = load();
  const has = current.wishlist.includes(productSlug);
  commit({
    ...current,
    wishlist: has ? current.wishlist.filter((s) => s !== productSlug) : [...current.wishlist, productSlug],
  });
  return !has;
}

export const selectCartCount = (s: StoreState) => s.cart.reduce((n, l) => n + l.quantity, 0);
export const selectWishlist = (s: StoreState) => s.wishlist;
export const selectCart = (s: StoreState) => s.cart;
