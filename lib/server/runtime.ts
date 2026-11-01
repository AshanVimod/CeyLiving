import "server-only";

/** SEC-A8 / AU-09: production turns off the demo session. Read on every call so tests can stub it. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}
