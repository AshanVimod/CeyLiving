import "server-only";
import { createHash, createHmac } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins/captcha";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { twoFactor } from "better-auth/plugins/two-factor";
import { z } from "zod";
import { getEnv, turnstileKeys } from "@/lib/env";
import type { PrismaClient } from "./db/generated/client";
import { appPrisma } from "./db/tx";
import { DEMO_ACCOUNTS } from "./demo-accounts";
import { queueEmail } from "./email/queue";
import { deleteOtherSessionsOf, findUserById, hasSecondStep, newId } from "./repositories/people";
import { db, withTx } from "./db/tx";
import { isProductionRuntime } from "./runtime";

// Real sign-in (B05a and B05b, backend plan AU-01 to AU-11). Better Auth owns passwords, sessions, email tokens,
// authenticator apps and passkeys; our `users` row stays the one source of truth for name, role and restrictions
// (AU-08). Pages and actions never call Better Auth directly: they use getSession() (lib/session.ts) and the actions
// in lib/server/actions/auth.ts and two-step.ts.

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

/** AU-03: a session ends after 7 days without use; lib/session.ts also ends it 30 days after sign-in. */
export const SESSION_IDLE_SECONDS = 7 * DAY;
export const SESSION_ABSOLUTE_SECONDS = 30 * DAY;

/** AU-03: admins' sessions end 12 hours after sign-in, or after 2 hours without use (checked in lib/session.ts). */
export const ADMIN_SESSION_ABSOLUTE_SECONDS = 12 * 60 * MINUTE;
export const ADMIN_SESSION_IDLE_SECONDS = 2 * 60 * MINUTE;

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
  twoFactor: "tfa",
  passkey: "pkey",
};

/**
 * AU-02: the routes whose new session was opened with two steps: an authenticator or recovery code after the
 * password, or a passkey (unlocked with the device's PIN or biometric, see `passkey()` below). The demo route counts
 * too; it exists only in development (AU-09), so the demo seller and admin can still open their areas.
 */
const TWO_STEP_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/passkey/verify-authentication",
  "/demo/sign-in",
]);

const ELEVATED_ROLES = new Set(["SELLER", "ADMIN"]);

/**
 * AU-02: routes that add, replace or remove a second step. Once an account has one, these need a session opened with
 * two steps; otherwise someone who only knows the password could add their own passkey or app and get past it.
 */
const SECOND_STEP_SETTINGS = new Set([
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
  "/passkey/update-passkey",
]);

/**
 * AU-02: recovery codes are stored as keyed hashes, never as the codes. Better Auth keeps "the list of codes" as one
 * string; ours is a JSON list of HMACs. A code typed at sign-in is hashed the same way (the before hook below) and
 * compared with the list, and a used one is removed from it (in one conditional update), so each works once.
 */
const RECOVERY_HASH = /^rc1:[0-9a-f]{64}$/;

export function hashRecoveryCode(code: string, secret: string): string {
  if (RECOVERY_HASH.test(code)) return code; // already a hash: the stored list after a code was used
  const normal = code.replace(/[\s-]/g, "");
  return `rc1:${createHmac("sha256", secret).update(`recovery-code:${normal}`).digest("hex")}`;
}

/** Better Auth's "encrypt" for the code list hashes every code; its "decrypt" hands back the hashes unchanged. */
function recoveryCodeStore(secret: string) {
  return {
    encrypt: async (json: string) =>
      JSON.stringify((JSON.parse(json) as string[]).map((code) => hashRecoveryCode(code, secret))),
    decrypt: async (stored: string) => stored,
  };
}

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

/**
 * B10: the sign-in emails are queued, never sent inside the request (backend plan 11.2), so a registered address
 * answers as fast as an unknown one (AU-07). The worker sends them. The key is a hash of the link: each new link is
 * one email, and the link itself is never logged.
 */
async function queueSignInEmail(template: "auth.verify" | "auth.reset", userId: string, url: string): Promise<void> {
  const key = createHash("sha256").update(url).digest("hex").slice(0, 32);
  await withTx((tx) => queueEmail(tx, template, { userId, key, data: { url } }));
}

function createAuth(prisma: PrismaClient) {
  const env = getEnv();
  const production = env.NODE_ENV === "production";
  // lib/env.ts requires a real secret in production; this fixed value only ever signs local development cookies.
  const secret = env.BETTER_AUTH_SECRET ?? "ceyliving-local-development-secret-not-for-production";
  return betterAuth({
    appName: "CeyLiving",
    baseURL: env.SITE_URL,
    secret,
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
      sendResetPassword: async ({ user, url }) => queueSignInEmail("auth.reset", user.id, url),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true, // signing in unverified sends a fresh link
      autoSignInAfterVerification: true,
      expiresIn: 60 * MINUTE,
      sendVerificationEmail: async ({ user, url }) => queueSignInEmail("auth.verify", user.id, url),
    },
    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: 15 * MINUTE, // a session in use is extended at most every 15 minutes
      // AU-02: set by the server when the session is created (databaseHooks below); no request can set it. No
      // default here, so a session that replaces another keeps the value it was given.
      additionalFields: { twoStep: { type: "boolean", required: false, input: false } },
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
        "/two-factor/verify-totp": AUTH_ATTEMPTS,
        "/two-factor/verify-backup-code": AUTH_ATTEMPTS,
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
          before: async (session, ctx) => {
            // AU-11: a deleted account can never get a session again (FR-17).
            const user = await findUserById(db, session.userId);
            if (!user || user.deletedAt) throw new APIError("FORBIDDEN", { message: "This account can’t sign in." });
            // AU-02: two steps just now, or a session replacing one that had them (password change, set-up).
            const current = ctx?.context.session?.session as { userId?: string; twoStep?: boolean } | undefined;
            const twoStep =
              session.twoStep === true ||
              TWO_STEP_PATHS.has(ctx?.path ?? "") ||
              (current?.userId === session.userId && current.twoStep === true);
            return { data: { ...session, twoStep } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // AU-02: a recovery code is compared as its hash (see recoveryCodeStore). Whatever arrives is hashed, so a
        // leaked hash is no use as a code. No "trust this device": every password sign-in asks for the second step.
        if (ctx.path === "/two-factor/verify-backup-code" && typeof ctx.body?.code === "string") {
          return {
            context: { body: { ...ctx.body, code: hashRecoveryCode(ctx.body.code, secret), trustDevice: false } },
          };
        }
        if (ctx.path === "/two-factor/verify-totp" && ctx.body?.trustDevice) {
          return { context: { body: { ...ctx.body, trustDevice: false } } };
        }
        if (!SECOND_STEP_SETTINGS.has(ctx.path ?? "")) return;
        const signedIn = await getSessionFromCtx(ctx);
        if (!signedIn) return; // Better Auth's own session check answers 401
        const twoStep = (signedIn.session as { twoStep?: boolean }).twoStep === true;
        if (!twoStep && (await hasSecondStep(db, signedIn.user.id))) {
          throw new APIError("FORBIDDEN", {
            message: "Sign in with your passkey or authenticator code first, then try again.",
          });
        }
        // AU-02: sellers and admins keep two-step; only customers may turn their authenticator app off.
        const role = (signedIn.user as { role?: string }).role;
        if (ctx.path === "/two-factor/disable" && role && ELEVATED_ROLES.has(role)) {
          throw new APIError("FORBIDDEN", { message: "Sellers and admins can’t turn two-step sign-in off." });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // AU-04: setting up two-step (confirming an authenticator app, or adding a passkey) ends every other session
        // of the account. For the app, Better Auth has already swapped this browser's session for a fresh one.
        const before = ctx.context.session;
        if (!before?.session || ctx.context.returned instanceof Error) return;
        const enabledApp = ctx.path === "/two-factor/verify-totp" && ctx.context.newSession;
        if (!enabledApp && ctx.path !== "/passkey/verify-registration") return;
        const keep = ctx.context.newSession?.session.token ?? before.session.token;
        await withTx((tx) => deleteOtherSessionsOf(tx, before.user.id, keep));
      }),
    },
    plugins: [
      haveIBeenPwned({
        customPasswordCompromisedMessage: "This password has appeared in a data breach. Choose another.",
      }),
      // AU-02: authenticator apps (TOTP) with one-use recovery codes. A password is asked for when the account has
      // one; accounts made before B05a may have none yet, and set up two-step with their session alone.
      twoFactor({
        issuer: "CeyLiving",
        allowPasswordless: true,
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: recoveryCodeStore(secret) },
      }),
      // AU-02: passkeys for everyone. The device must check its owner (PIN or biometric), so a passkey on its own
      // counts as two steps.
      passkey({
        rpID: new URL(env.SITE_URL).hostname,
        rpName: "CeyLiving",
        origin: env.SITE_URL,
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        authentication: {
          afterVerification: async ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError("UNAUTHORIZED", { message: "Unlock the passkey with your PIN or fingerprint." });
            }
          },
        },
      }),
      // AU-06: Better Auth's own routes, called straight over HTTP, always need a Turnstile token (header
      // x-captcha-response). The site's forms don't use them: they call the server actions, which check Turnstile
      // themselves (always on sign-up and reset, after 3 failed attempts on sign-in).
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: turnstileKeys(env).secretKey,
        endpoints: ["/sign-up/email", "/sign-in/email", "/request-password-reset"],
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
