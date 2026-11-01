"use server";

import { createHash } from "node:crypto";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { getEnv } from "@/lib/env";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  registerSchema,
  resetPasswordSchema,
  signInSchema,
} from "@/lib/validation/auth";
import { requireActor, safeNextPath } from "../auth";
import { AUTH_ATTEMPTS, getAuth } from "../better-auth";
import { withTx } from "../db/tx";
import { RateLimitError, ValidationError } from "../errors";
import { countAuthAttempt } from "../repositories/people";
import { formToObject, parseInput, runAction } from "../run-action";

// Sign-in forms (B05a, AU-01 to AU-07). Each action validates with zod (SEC-A3), counts the attempt per email and
// per IP (AU-06), calls Better Auth on the server, and turns its answers into messages that never reveal whether
// an email is registered (AU-07).

const SAME_ANSWER = "If an account exists for that email, we’ve sent a link. It works once, for 1 hour.";
const WRONG_DETAILS = "That email and password don’t match an account. Check them and try again.";

/** The visitor's address as Cloudflare (or the proxy in front) reports it; "unknown" counts as one visitor. */
function clientIp(requestHeaders: Headers): string {
  return (
    requestHeaders.get("cf-connecting-ip") ?? requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  );
}

const hashed = (value: string) => createHash("sha256").update(value).digest("hex");

/** AU-06: at most 5 attempts per 15 minutes for this email and for this IP; the email is stored only as a hash. */
async function limitAttempts(kind: string, email: string, requestHeaders: Headers): Promise<void> {
  const windowMs = AUTH_ATTEMPTS.window * 1000;
  const now = Date.now();
  const [byEmail, byIp] = await withTx(async (tx) => [
    await countAuthAttempt(tx, `ceyliving:${kind}:email:${hashed(email)}`, windowMs, now),
    await countAuthAttempt(tx, `ceyliving:${kind}:ip:${clientIp(requestHeaders)}`, windowMs, now),
  ]);
  if (byEmail > AUTH_ATTEMPTS.max || byIp > AUTH_ATTEMPTS.max) {
    throw new RateLimitError("Too many attempts. Wait 15 minutes, then try again.");
  }
}

const codeOf = (error: unknown) => (isAPIError(error) ? (error.body?.code as string | undefined) : undefined);

/** AU-01: Better Auth's breached-password answer becomes a message on the password field. */
function passwordProblem(error: unknown): never {
  if (codeOf(error) === "PASSWORD_COMPROMISED") {
    throw new ValidationError("Choose another password.", {
      password: "This password has appeared in a data breach. Choose one you haven’t used elsewhere.",
    });
  }
  throw error;
}

export async function signInAction(_: ActionState, form: FormData): Promise<ActionResult> {
  let next = "/account";
  const result = await runAction(async () => {
    const input = parseInput(signInSchema, formToObject(form));
    next = safeNextPath(input.next);
    const requestHeaders = await headers();
    await limitAttempts("sign-in", input.email, requestHeaders);
    try {
      await getAuth().api.signInEmail({
        body: { email: input.email, password: input.password, rememberMe: true },
        headers: requestHeaders,
      });
    } catch (error) {
      const code = codeOf(error);
      // Only someone who knows the password learns the email is unconfirmed; Better Auth sends a fresh link.
      if (code === "EMAIL_NOT_VERIFIED") {
        return { ok: false, message: "Confirm your email first: we’ve sent you a new link." };
      }
      if (isAPIError(error)) return { ok: false, message: WRONG_DETAILS }; // wrong details, or a deleted account
      throw error;
    }
  });
  if (!result.ok || result.message) return result;
  redirect(next);
}

export async function registerAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = parseInput(registerSchema, formToObject(form));
    const requestHeaders = await headers();
    await limitAttempts("sign-up", input.email, requestHeaders);
    // After confirming, people land where they were going (for example the shop application).
    const callbackURL = `${getEnv().SITE_URL}${safeNextPath(input.next)}`;
    try {
      await getAuth().api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password, callbackURL },
        headers: requestHeaders,
      });
    } catch (error) {
      passwordProblem(error);
    }
    // AU-07: the same answer whether the email was new or already registered.
    return {
      ok: true,
      message: `Check ${input.email} for a link to confirm your address. It works once, for 1 hour.`,
    };
  });
}

export async function forgotPasswordAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = parseInput(forgotPasswordSchema, formToObject(form));
    const requestHeaders = await headers();
    await limitAttempts("reset", input.email, requestHeaders);
    await getAuth()
      .api.requestPasswordReset({
        body: { email: input.email, redirectTo: `${getEnv().SITE_URL}/reset-password` },
        headers: requestHeaders,
      })
      .catch((error: unknown) => {
        if (!isAPIError(error)) throw error; // AU-07: Better Auth's own refusals look the same as success
      });
    return { ok: true, message: SAME_ANSWER };
  });
}

export async function resetPasswordAction(_: ActionState, form: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const input = parseInput(resetPasswordSchema, formToObject(form));
    try {
      // AU-04: Better Auth ends every session of the account (revokeSessionsOnPasswordReset).
      await getAuth().api.resetPassword({ body: { token: input.token, newPassword: input.password } });
    } catch (error) {
      if (codeOf(error) === "INVALID_TOKEN") {
        return { ok: false, message: "This link has expired or was already used. Ask for a new one." };
      }
      passwordProblem(error);
    }
  });
  if (!result.ok) return result;
  redirect("/signin?reset=1");
}

export async function changePasswordAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await requireActor();
    const input = parseInput(changePasswordSchema, formToObject(form));
    try {
      // AU-04: every other session ends; this browser gets a fresh one.
      await getAuth().api.changePassword({
        body: { currentPassword: input.currentPassword, newPassword: input.password, revokeOtherSessions: true },
        headers: await headers(),
      });
    } catch (error) {
      if (codeOf(error) === "INVALID_PASSWORD") {
        throw new ValidationError("Check your current password.", {
          currentPassword: "That isn’t your current password.",
        });
      }
      if (codeOf(error) === "CREDENTIAL_ACCOUNT_NOT_FOUND") {
        throw new ValidationError(
          "This account has no password yet. Use “Forgot password” on the sign-in page to set one.",
        );
      }
      passwordProblem(error);
    }
    return { ok: true, message: "Password changed. You’ve been signed out everywhere else." };
  });
}
