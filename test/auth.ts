import { makeSignature } from "better-auth/crypto";
import { getAuth } from "@/lib/server/better-auth";

// Real Better Auth sessions in tests (B05a). Test files mock "next/headers" with `nextHeaders` below, so the app's
// getSession() and server actions read and write this cookie jar exactly as they would a browser's cookies.

export const SESSION_COOKIE = "ceyliving.session_token";

export const jar = new Map<string, string>();

const jarHeaders = () =>
  new Headers({
    "x-forwarded-for": testIp.value,
    ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
  });

/**
 * Like Next.js during one request: headers() keeps the cookies the request arrived with, even after an action
 * sets new ones; only cookies() sees the change (B05b). Off by default, so each call is like a new request.
 */
export const request = { frozen: null as Headers | null };

/** Starts a "request": headers() stays as it is now until `endRequest()`. */
export function startRequest() {
  request.frozen = jarHeaders();
}

export function endRequest() {
  request.frozen = null;
}

/**
 * For vi.mock("next/headers", ...): headers() carries the jar's cookies (or a frozen copy, see startRequest);
 * cookies() reads and writes the jar.
 */
export const nextHeaders = {
  headers: async () => request.frozen ?? jarHeaders(),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (!value || options?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
  }),
};

/** The visitor's IP as the app sees it (x-forwarded-for); tests change it to check per-IP limits. */
export const testIp = { value: "203.0.113.10" };

/**
 * Signs `userId` in with a real session row and signed cookie, as Better Auth would after a sign-in. By default the
 * session counts as opened with two steps (AU-02), as a seller's or admin's would be; pass `twoStep: false` for a
 * password-only session.
 */
export async function signInAs(userId: string, { twoStep = true }: { twoStep?: boolean } = {}) {
  const ctx = await getAuth().$context;
  const session = await ctx.internalAdapter.createSession(userId, false, { twoStep });
  const value = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  jar.set(SESSION_COOKIE, encodeURIComponent(value));
  return session;
}

export function signOutLocally() {
  jar.clear();
  endRequest();
}
