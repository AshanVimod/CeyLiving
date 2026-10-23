import "server-only";

/** SEC-A8: production turns off the demo session and the dev store's writes. Read on every call so tests can stub it. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}
