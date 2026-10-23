import "server-only";

// Runtime switches, read from the environment on every call so tests can stub them.
// lib/env.ts validates the values at start-up.

/** SEC-A8: production turns off the demo session and the dev store's writes. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Feature-02 public demo (DEMO_MODE=true): in-memory store, demo sign-in, banner and noindex. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** Demo sign-in works in development and tests, and in production only on the public demo (AU-09, SEC-A8). */
export function demoSignInAllowed(): boolean {
  return !isProductionRuntime() || isDemoMode();
}
