import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server-rendered HTML and until React has taken over the page in the browser, then true. Forms that
 * only work with JavaScript keep their buttons disabled until then, so nothing is sent half-ready; the cart uses it
 * so its server-rendered skeleton isn't replaced by an "empty cart" flash.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
