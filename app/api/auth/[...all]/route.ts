import { getAuth } from "@/lib/server/better-auth";

// Better Auth's own endpoints (B05a): the links in verification and reset emails land here, and so do browser-side
// calls such as passkeys in B05b. Sign-in and sign-up from our forms go through server actions instead.
export const GET = (request: Request) => getAuth().handler(request);
export const POST = (request: Request) => getAuth().handler(request);
