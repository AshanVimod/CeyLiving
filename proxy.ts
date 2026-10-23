import { NextResponse, type NextRequest } from "next/server";

// Must match DEMO_SESSION_COOKIE in lib/session.ts (proxy can't import server-only modules).
const SESSION_COOKIE = "ceyliving_demo_session";

/**
 * A fast first gate: visitors with no session cookie are sent to sign in and back to the exact page.
 * This is a convenience, not the security check: every layout, page and action still verifies the
 * user and role on the server (SEC-A1).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === "/account/wishlist") return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/account/:path*", "/seller/:path*", "/admin/:path*", "/sell/apply/:path*"],
};
