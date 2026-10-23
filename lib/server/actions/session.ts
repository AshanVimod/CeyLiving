"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_SESSION_MAX_AGE_SECONDS } from "@/lib/config";
import { DEMO_SESSION_COOKIE } from "@/lib/session";
import { safeNextPath } from "../auth";
import { findUserById } from "../repositories/people";
import { db } from "../db/tx";
import { isProductionRuntime } from "../runtime";
import { z } from "zod";
import { DEMO_ACCOUNTS } from "../store/seed";

/** SEC-A3: the demo form carries only an account from the demo list and an optional return path. */
const demoSignInSchema = z.object({
  userId: z.enum(DEMO_ACCOUNTS.map((a) => a.id) as [string, ...string[]]),
  next: z.string().max(500).optional(),
});

/**
 * Development-only sign-in as one of the seeded demo accounts (feature spec 7.5).
 * Only IDs on the demo list are accepted, and the cookie is HttpOnly and SameSite=Lax.
 */
export async function signInAsDemo(formData: FormData): Promise<void> {
  if (isProductionRuntime()) redirect("/signin");
  const parsed = demoSignInSchema.safeParse({
    userId: formData.get("userId") ?? undefined,
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) redirect("/signin");
  const { userId, next } = parsed.data;
  const user = await findUserById(db, userId);
  if (!user || user.deletedAt) redirect("/signin");
  const store = await cookies();
  store.set(DEMO_SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEMO_SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(next));
}

/** Ends the session. With Better Auth this becomes its signOut call. */
export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(DEMO_SESSION_COOKIE);
  redirect("/");
}
