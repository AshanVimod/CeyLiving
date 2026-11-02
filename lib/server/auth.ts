import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "@/lib/session";
import type { Role } from "@/lib/types";
import { UnauthorizedError } from "./errors";

// Session-aware guards. Pages use requireUser/requireRole (redirect); actions use requireActor (error result).

export async function currentUser(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}

/** Sends signed-out visitors to sign in and back again. `next` must be a path on this site. */
export async function requireUser(next: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(next)}`);
  return user;
}

/**
 * Deny by default (SEC-A1): wrong role goes to the account page. AU-02: a seller or admin whose session wasn't
 * opened with two steps goes to set it up, then comes back to `next`.
 */
export async function requireRole(roles: Role[], next: string): Promise<SessionUser> {
  const user = await requireUser(next);
  if (!roles.includes(user.role)) redirect("/account");
  if (user.needsTwoStep) redirect(`/account/two-step?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireActor(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Only same-site paths are allowed as post-sign-in destinations (no open redirects). */
export function safeNextPath(next: unknown, fallback = "/account"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\"))
    return fallback;
  return next;
}
