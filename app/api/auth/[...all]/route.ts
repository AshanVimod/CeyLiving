import { getAuth } from "@/lib/server/better-auth";
import { withRoute } from "@/lib/server/observability/route";
import { withRateLimitPseudonym } from "@/lib/server/security/ip";

// Better Auth's own endpoints (B05a): the links in verification and reset emails land here, and so do browser-side
// calls such as passkeys in B05b. Sign-in and sign-up from our forms go through server actions instead.
// B12 (12.2): wrapped like every route, so POSTs need our Origin and stay under 1 MB, and every call is logged.
// B12 (12.4): Better Auth gets a keyed stand-in for the visitor's IP, never the address (lib/server/security/ip.ts).
export const GET = withRoute("api.auth", (request) => getAuth().handler(withRateLimitPseudonym(request)));
export const POST = withRoute("api.auth", (request) => getAuth().handler(withRateLimitPseudonym(request)));
