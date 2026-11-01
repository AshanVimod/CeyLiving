import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, resolveRequestId } from "./lib/server/observability/request-id";

// AU-10: Better Auth's session cookie (cookiePrefix "ceyliving" in lib/server/better-auth.ts); production adds the
// __Secure- prefix. Proxy only checks that one is present; layouts and actions check that it is valid (SEC-A1).
const SESSION_COOKIES = ["ceyliving.session_token", "__Secure-ceyliving.session_token"];

// Areas that need a session. The matcher below covers every page now, so the gate checks the path itself.
const PROTECTED = /^\/(account|seller|admin|sell\/apply)(\/|$)/;

/**
 * Runs on every page, action and API request.
 * OPS-02: gives the request an ID (Cloudflare's cf-ray when present), passed upstream and back on the response.
 * A fast first gate: visitors with no session cookie are sent to sign in and back to the exact page.
 * This is a convenience, not the security check: every layout, page and action still verifies the
 * user and role on the server (SEC-A1).
 */
export function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request.headers);
  const response = gate(request, requestId);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function gate(request: NextRequest, requestId: string) {
  const { pathname, search } = request.nextUrl;
  if (
    !PROTECTED.test(pathname) ||
    pathname === "/account/wishlist" ||
    SESSION_COOKIES.some((name) => request.cookies.has(name))
  ) {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return NextResponse.next({ request: { headers } });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except build assets and image optimisation.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
