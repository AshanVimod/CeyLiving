"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_SESSION_MAX_AGE_SECONDS } from "@/lib/config";
import { DEMO_SESSION_COOKIE } from "@/lib/session";
import { safeNextPath } from "../auth";
import { findUserById } from "../repositories/people";
import { isProductionRuntime } from "../store/dev-store";
import { DEMO_ACCOUNTS } from "../store/seed";

/**
 * Development-only sign-in as one of the seeded demo accounts (feature spec 7.5).
 * Only IDs on the demo list are accepted, and the cookie is HttpOnly and SameSite=Lax.
 */
export async function signInAsDemo(formData: FormData): Promise<void> {
  if (isProductionRuntime()) redirect("/signin");
  const userId = formData.get("userId");
  const allowed = DEMO_ACCOUNTS.some((a) => a.id === userId);
  if (typeof userId !== "string" || !allowed || !findUserById(userId) || findUserById(userId)?.deletedAt) redirect("/signin");
  const store = await cookies();
  store.set(DEMO_SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(formData.get("next")));
}

/** Ends the session. With Better Auth this becomes its signOut call. */
export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(DEMO_SESSION_COOKIE);
  redirect("/");
}
