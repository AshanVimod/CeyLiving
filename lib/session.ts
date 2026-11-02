import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import {
  ADMIN_SESSION_ABSOLUTE_SECONDS,
  ADMIN_SESSION_IDLE_SECONDS,
  getAuth,
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
} from "./server/better-auth";
import { deleteSessionByToken, findUserById } from "./server/repositories/people";
import { db, withTx } from "./server/db/tx";
import type { Role, User } from "./types";

export type { Role };

/**
 * The signed-in person. `needsTwoStep` is set for a seller or admin whose session wasn't opened with two steps
 * (AU-02): the /seller and /admin areas and their actions stay closed until they set it up or sign in with it.
 */
export type SessionUser = User & { needsTwoStep?: boolean };

export interface Session {
  user: SessionUser;
}

const REFRESH_EVERY_SECONDS = 15 * 60; // updateAge in lib/server/better-auth.ts

/** Better Auth's session cookie, with the __Secure- prefix it gets in production. */
const SESSION_COOKIE = /^(__Secure-)?ceyliving\.session_token$/;

/** Per request (keyed by its headers object): the session cookie a server action just replaced the old one with. */
const replacedSessionCookie = new WeakMap<object, string>();

/**
 * AU-04: call in a server action right after Better Auth replaced this browser's session (two-step set-up, password
 * change), with the headers its call returned. Next.js draws the page again in the same request, and headers()
 * still carries the old cookie, whose session is gone; cookies() can't be relied on after an action either (Next.js
 * 16 hands back the request's original cookies). getSession() uses the new cookie for the rest of the request.
 */
export async function rememberReplacedSession(responseHeaders: Headers): Promise<void> {
  const cookie = responseHeaders
    .getSetCookie()
    .map((line) => line.split(";")[0]!)
    .findLast((pair) => SESSION_COOKIE.test(pair.split("=")[0]!) && pair.split("=")[1]);
  if (cookie) replacedSessionCookie.set(await headers(), cookie);
}

/** This request's headers, with the replaced session cookie when an action changed it. */
async function currentHeaders(): Promise<Headers> {
  const requestHeaders = await headers();
  const replaced = replacedSessionCookie.get(requestHeaders);
  if (!replaced) return requestHeaders;
  const name = replaced.split("=")[0];
  const others = (requestHeaders.get("cookie") ?? "").split(/;\s*/).filter((p) => p && p.split("=")[0] !== name);
  const updated = new Headers(requestHeaders);
  updated.set("cookie", [...others, replaced].join("; "));
  return updated;
}

/**
 * AU-05: who is signed in, from the Better Auth session cookie. Returns the same `{ user }` as before B05, built
 * from our `users` row, so role and restrictions changed by an admin show at once and every guard keeps working.
 */
export async function getSession(): Promise<Session | null> {
  // Everything that depends on who is signed in is request-time; prerendering stops here.
  await connection();
  const requestHeaders = await currentHeaders();
  // Read without extending it first, so the time limits below see when the session was last really used.
  const result = await getAuth().api.getSession({ headers: requestHeaders, query: { disableRefresh: true } });
  if (!result) return null;
  const session = result.session as typeof result.session & { twoStep?: boolean | null };
  const now = Date.now();
  const age = now - new Date(session.createdAt).getTime();
  const idle = now - new Date(session.updatedAt).getTime();
  const end = async () => {
    await withTx((tx) => deleteSessionByToken(tx, session.token));
    return null;
  };
  // AU-03: 30 days after sign-in a session ends, however often it was used.
  if (age > SESSION_ABSOLUTE_SECONDS * 1000) return end();
  const user = await findUserById(db, result.user.id);
  // FR-17 / AU-11: a deleted account can never be signed in.
  if (!user || user.deletedAt) return null;
  // AU-03: an admin's session ends 12 hours after sign-in, or 2 hours after it was last used. Use is recorded when
  // the session is extended (at most every 15 minutes), so "2 hours" can be up to 15 minutes longer.
  if (
    user.role === "ADMIN" &&
    (age > ADMIN_SESSION_ABSOLUTE_SECONDS * 1000 || idle > ADMIN_SESSION_IDLE_SECONDS * 1000)
  ) {
    return end();
  }
  // AU-03: extend a session in use (Better Auth does it, at most every 15 minutes, and refreshes the cookie).
  const extendedAt = new Date(session.expiresAt).getTime() - SESSION_IDLE_SECONDS * 1000;
  if (now - extendedAt >= REFRESH_EVERY_SECONDS * 1000) {
    await getAuth()
      .api.getSession({ headers: requestHeaders })
      .catch(() => null); // a session ended between the two reads is caught on the next request
  }
  const needsTwoStep = (user.role === "SELLER" || user.role === "ADMIN") && session.twoStep !== true;
  return { user: needsTwoStep ? { ...user, needsTwoStep } : user };
}
