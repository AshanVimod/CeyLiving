"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNextPath } from "../auth";
import { demoSignInAllowed, getAuth } from "../better-auth";
import { DEMO_ACCOUNTS } from "../demo-accounts";

/** SEC-A3: the demo form carries only an account from the demo list and an optional return path. */
const demoSignInSchema = z.object({
  userId: z.enum(DEMO_ACCOUNTS.map((a) => a.id) as [string, ...string[]]),
  next: z.string().max(500).optional(),
});

interface DemoApi {
  demoSignIn?: (input: { body: { userId: string }; headers: Headers }) => Promise<unknown>;
}

/**
 * AU-09: development-only sign-in as one of the seeded demo accounts (feature spec 7.5). It creates a real Better
 * Auth session, so the rest of the app has one way of knowing who is signed in. Refused unless
 * ENABLE_DEMO_LOGIN=true outside production; the endpoint doesn't even exist in production builds.
 */
export async function signInAsDemo(formData: FormData): Promise<void> {
  if (!demoSignInAllowed()) redirect("/signin");
  const parsed = demoSignInSchema.safeParse({
    userId: formData.get("userId") ?? undefined,
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) redirect("/signin");
  const api = getAuth().api as DemoApi;
  if (!api.demoSignIn) redirect("/signin");
  try {
    await api.demoSignIn({ body: { userId: parsed.data.userId }, headers: await headers() });
  } catch {
    redirect("/signin");
  }
  redirect(safeNextPath(parsed.data.next));
}

/** Ends this browser's session. */
export async function signOut(): Promise<void> {
  await getAuth()
    .api.signOut({ headers: await headers() })
    .catch(() => undefined); // already signed out: nothing to end
  redirect("/");
}

/** AU-04: "Sign out everywhere" ends every session of the signed-in person, this one included. */
export async function signOutEverywhere(): Promise<void> {
  const requestHeaders = await headers();
  await getAuth()
    .api.revokeSessions({ headers: requestHeaders })
    .catch(() => undefined);
  await getAuth()
    .api.signOut({ headers: requestHeaders })
    .catch(() => undefined);
  redirect("/signin?signedOut=everywhere");
}
