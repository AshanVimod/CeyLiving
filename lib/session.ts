import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getAuth, SESSION_ABSOLUTE_SECONDS } from "./server/better-auth";
import { deleteSessionByToken, findUserById } from "./server/repositories/people";
import { db, withTx } from "./server/db/tx";
import type { Role, User } from "./types";

export type { Role };
export type SessionUser = User;

export interface Session {
  user: SessionUser;
}

/**
 * AU-05: who is signed in, from the Better Auth session cookie. Returns the same `{ user }` as before B05, built
 * from our `users` row, so role and restrictions changed by an admin show at once and every guard keeps working.
 */
export async function getSession(): Promise<Session | null> {
  // Everything that depends on who is signed in is request-time; prerendering stops here.
  await connection();
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  // AU-03: 30 days after sign-in a session ends, however often it was used.
  if (Date.now() - new Date(result.session.createdAt).getTime() > SESSION_ABSOLUTE_SECONDS * 1000) {
    await withTx((tx) => deleteSessionByToken(tx, result.session.token));
    return null;
  }
  const user = await findUserById(db, result.user.id);
  // FR-17 / AU-11: a deleted account can never be signed in.
  return user && !user.deletedAt ? { user } : null;
}
