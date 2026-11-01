import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import type { PrismaClient } from "./db/generated/client";
import { appPrisma } from "./db/tx";
import { DEMO_ACCOUNTS } from "./demo-accounts";
import { resetPasswordMessage, verifyEmailMessage } from "./email/auth-emails";
import { sendEmail } from "./email/send";
import { findUserById, newId } from "./repositories/people";
import { db } from "./db/tx";
import { isProductionRuntime } from "./runtime";

// Real sign-in (B05a, backend plan AU-01 to AU-11). Better Auth owns passwords, sessions and email tokens; our
// `users` row stays the one source of truth for name, role and restrictions (AU-08). Pages and actions never call
// Better Auth directly: they use getSession() (lib/session.ts) and the actions in lib/server/actions/auth.ts.

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

/** AU-03: a session ends after 7 days without use; lib/session.ts also ends it 30 days after sign-in. */
export const SESSION_IDLE_SECONDS = 7 * DAY;
export const SESSION_ABSOLUTE_SECONDS = 30 * DAY;

/** AU-06: sign-in, sign-up and reset requests allowed per window, per IP (here) and per email (auth actions). */
export const AUTH_ATTEMPTS = { window: 15 * MINUTE, max: 5 };

/** AU-09: demo sign-in exists only in development, and only when ENABLE_DEMO_LOGIN=true. */
export function demoSignInAllowed(): boolean {
  return !isProductionRuntime() && getEnv().ENABLE_DEMO_LOGIN;
}

const ID_PREFIX: Record<string, string> = {
  user: "user",
  session: "sess",
  account: "acct",
  verification: "verif",
  rateLimit: "rl",
};

/** Development-only endpoint: signs in as a demo account with a real session (so the app has one session path). */
const demoSignIn = () => ({
  id: "ceyliving-demo-sign-in",
  endpoints: {
    demoSignIn: createAuthEndpoint(
      "/demo/sign-in",
      { method: "POST", body: z.object({ userId: z.enum(DEMO_ACCOUNTS.map((a) => a.id) as [string, ...string[]]) }) },
      async (ctx) => {
        if (!demoSignInAllowed()) throw new APIError("NOT_FOUND");
        const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
        if (!user) throw new APIError("NOT_FOUND");
        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      },
    ),
  },
});

function createAuth(prisma: PrismaClient) {
  const env = getEnv();
  const production = env.NODE_ENV === "production";
  return betterAuth({
    appName: "CeyLiving",
    baseURL: env.SITE_URL,
    // lib/env.ts requires a real secret in production; this fixed value only ever signs local development cookies.
    secret: env.BETTER_AUTH_SECRET ?? "ceyliving-local-development-secret-not-for-production",
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    telemetry: { enabled: false },
    user: {
      // AU-08: role and restrictions belong to the app. `input: false` means no sign-up request can set them.
      additionalFields: {
        role: { type: "string", defaultValue: "CUSTOMER", input: false },
        postingRestriction: { type: "string", defaultValue: "NONE", input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10, // AU-01
      maxPasswordLength: 128,
      // AU-01 / AU-07: no session until the email is confirmed, and signing up with a registered email gives the
      // same answer as a new one (Better Auth returns a stand-in user and sends nothing new).
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true, // AU-04
      resetPasswordTokenExpiresIn: 60 * MINUTE,
      sendResetPassword: async ({ user, url }) => sendEmail(resetPasswordMessage(user.email, url)),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true, // signing in unverified sends a fresh link
      autoSignInAfterVerification: true,
      expiresIn: 60 * MINUTE,
      sendVerificationEmail: async ({ user, url }) => sendEmail(verifyEmailMessage(user.email, url)),
    },
    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 15 * MINUTE, // a session in use is extended at most every 15 minutes
    },
    rateLimit: {
      // AU-06: counters live in PostgreSQL, so every app instance shares them.
      enabled: env.NODE_ENV !== "test",
      storage: "database",
      modelName: "rateLimit",
      window: MINUTE,
      max: 100,
      customRules: {
        "/sign-in/email": AUTH_ATTEMPTS,
        "/sign-up/email": AUTH_ATTEMPTS,
        "/request-password-reset": AUTH_ATTEMPTS,
        "/reset-password": AUTH_ATTEMPTS,
      },
    },
    advanced: {
      cookiePrefix: "ceyliving",
      useSecureCookies: production, // AU-03: Secure, and the __Secure- name prefix, in production
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      database: { generateId: ({ model }) => newId(ID_PREFIX[model] ?? model) },
    },
    databaseHooks: {
      session: {
        create: {
          // AU-11: a deleted account can never get a session again (FR-17).
          before: async (session) => {
            const user = await findUserById(db, session.userId);
            if (!user || user.deletedAt) throw new APIError("FORBIDDEN", { message: "This account can’t sign in." });
          },
        },
      },
    },
    plugins: [
      haveIBeenPwned({
        customPasswordCompromisedMessage: "This password has appeared in a data breach. Choose another.",
      }),
      ...(production ? [] : [demoSignIn()]),
      nextCookies(), // lets server actions set the session cookie; must stay last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: { prisma: PrismaClient; auth: Auth } | undefined;

/** The Better Auth instance for the app's current database client (tests switch databases per file). */
export function getAuth(): Auth {
  const prisma = appPrisma();
  if (instance?.prisma !== prisma) instance = { prisma, auth: createAuth(prisma) };
  return instance.auth;
}
