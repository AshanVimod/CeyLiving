import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { findUserById } from "./server/repositories/people";
import { db } from "./server/db/tx";
import { demoSignInAllowed } from "./server/runtime";
import type { Role, User } from "./types";

export type { Role };
export type SessionUser = User;

export interface Session {
  user: SessionUser;
}

/** Development-only cookie (and the public demo's) holding a demo user's ID; set by the Demo accounts panel on /signin. */
export const DEMO_SESSION_COOKIE = "ceyliving_demo_session";

/**
 * Placeholder until Better Auth lands (T04): always signed out in production, except on the public demo (DEMO_MODE).
 * The user is loaded from the store on every request, so role changes (applicant → seller) show at once.
 */
export async function getSession(): Promise<Session | null> {
  // Everything that depends on who is signed in is request-time; prerendering stops here.
  await connection();
  const store = await cookies();
  if (!demoSignInAllowed()) return null;
  const userId = store.get(DEMO_SESSION_COOKIE)?.value;
  if (!userId) return null;
  const user = await findUserById(db, userId);
  // FR-17: a deleted account can never sign in again.
  return user && !user.deletedAt ? { user } : null;
}
