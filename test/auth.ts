import { makeSignature } from "better-auth/crypto";
import { getAuth } from "@/lib/server/better-auth";

// Real Better Auth sessions in tests (B05a). Test files mock "next/headers" with `nextHeaders` below, so the app's
// getSession() and server actions read and write this cookie jar exactly as they would a browser's cookies.

export const SESSION_COOKIE = "ceyliving.session_token";

export const jar = new Map<string, string>();

/** For vi.mock("next/headers", ...): headers() carries the jar's cookies; cookies() reads and writes the jar. */
export const nextHeaders = {
  headers: async () =>
    new Headers({
      "x-forwarded-for": testIp.value,
      ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    }),
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

/** Signs `userId` in with a real session row and signed cookie, as Better Auth would after a sign-in. */
export async function signInAs(userId: string) {
  const ctx = await getAuth().$context;
  const session = await ctx.internalAdapter.createSession(userId);
  const value = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  jar.set(SESSION_COOKIE, encodeURIComponent(value));
  return session;
}

export function signOutLocally() {
  jar.clear();
}
