"use server";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { renderSVG } from "uqr";
import type { ActionResult, ActionState } from "@/lib/action-result";
import { appCodeSchema, confirmPasswordSchema, passkeyIdSchema, twoStepSignInSchema } from "@/lib/validation/auth";
import { rememberReplacedSession } from "@/lib/session";
import { requireActor, safeNextPath } from "../auth";
import { getAuth } from "../better-auth";
import { ForbiddenError, ValidationError } from "../errors";
import { formToObject, parseInput, runAction } from "../run-action";
import { countEvent } from "../services/ops";

// Two-step sign-in (B05b, AU-02 and AU-04): the second step at sign-in, setting up an authenticator app, recovery
// codes and removing passkeys. Adding a passkey and signing in with one happen in the browser (WebAuthn), through
// Better Auth's own routes; everything here runs on the server and checks the session itself (SEC-A1).

/** What the app set-up form gets back after the password: the QR code, the same key typed out, and the codes. */
export type AppSetupResult = ActionResult & {
  setup?: { qrCode: string; key: string; recoveryCodes: string[] };
};

/** New recovery codes, shown once. */
export type RecoveryCodesResult = ActionResult & { recoveryCodes?: string[] };

const codeOf = (error: unknown) => (isAPIError(error) ? (error.body?.code as string | undefined) : undefined);

const WRONG_CODE = "That code didn’t work. Check it and try again.";
const START_AGAIN = "Your sign-in took too long, or had too many tries. Sign in again.";

/** AU-02: the second step at sign-in, after the password. Finishes the sign-in and goes where the person was going. */
export async function verifyTwoStepAction(_: ActionState, form: FormData): Promise<ActionResult> {
  let next = "/account";
  const result = await runAction(async () => {
    const input = parseInput(twoStepSignInSchema, formToObject(form));
    next = safeNextPath(input.next);
    const requestHeaders = await headers();
    try {
      // Better Auth reads its short-lived second-step cookie, allows 5 tries per sign-in and locks the account for
      // 15 minutes after 10 failures in a row.
      if (input.method === "app") {
        await getAuth().api.verifyTOTP({ body: { code: input.code }, headers: requestHeaders });
      } else {
        await getAuth().api.verifyBackupCode({ body: { code: input.code }, headers: requestHeaders });
      }
    } catch (error) {
      const code = codeOf(error);
      if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE") {
        await countEvent("sign_in_failed"); // B12 (OPS-06): a wrong second step counts as a failed sign-in
        throw new ValidationError(WRONG_CODE, { code: WRONG_CODE });
      }
      if (code === "ACCOUNT_TEMPORARILY_LOCKED") {
        return { ok: false, message: "Too many wrong codes. Wait 15 minutes, then sign in again." };
      }
      if (isAPIError(error)) return { ok: false, message: START_AGAIN };
      throw error;
    }
  });
  if (!result.ok) return result;
  redirect(next);
}

/** The key inside an otpauth:// link, in groups of four so it is easier to type into an app. */
function readableKey(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * AU-02, step 1 of setting up an authenticator app: checks the password (when the account has one) and returns a
 * new key as a QR code and as text, plus the recovery codes. Nothing changes at sign-in until a first code is
 * confirmed (step 2), so stopping halfway is harmless.
 */
export async function startAppSetupAction(_: ActionState, form: FormData): Promise<AppSetupResult> {
  return runAction<AppSetupResult>(async () => {
    await requireActor();
    const input = parseInput(confirmPasswordSchema, formToObject(form));
    try {
      const result = await getAuth().api.enableTwoFactor({
        body: { password: input.password || undefined },
        headers: await headers(),
      });
      if (!("totpURI" in result)) throw new Error("Better Auth did not return an authenticator key");
      const svg = renderSVG(result.totpURI, { border: 2 });
      return {
        ok: true,
        setup: {
          qrCode: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          key: readableKey(result.totpURI),
          recoveryCodes: result.backupCodes,
        },
      };
    } catch (error) {
      const code = codeOf(error);
      if (code === "INVALID_PASSWORD") {
        throw new ValidationError("Check your password.", { password: "That isn’t your password." });
      }
      if (code === "TOTP_ALREADY_ENABLED") throw new ValidationError("An authenticator app is already set up.");
      throw error;
    }
  });
}

/**
 * AU-02, step 2: the first code from the app turns two-step on. AU-04: Better Auth gives this browser a fresh
 * session, and the after hook in lib/server/better-auth.ts ends every other session of the account.
 */
export async function confirmAppSetupAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await requireActor();
    const input = parseInput(appCodeSchema, formToObject(form));
    try {
      const result = await getAuth().api.verifyTOTP({
        body: { code: input.code },
        headers: await headers(),
        returnHeaders: true,
      });
      await rememberReplacedSession(result.headers); // so the page drawn after this action still sees the person
    } catch (error) {
      if (codeOf(error) === "INVALID_CODE") throw new ValidationError(WRONG_CODE, { code: WRONG_CODE });
      if (codeOf(error) === "TOTP_NOT_ENABLED") throw new ValidationError("Start again: ask for a new QR code.");
      throw error;
    }
    return { ok: true, message: "Two-step sign-in is on. You’ve been signed out on your other devices." };
  });
}

function passwordProblem(error: unknown): never {
  if (codeOf(error) === "INVALID_PASSWORD") {
    throw new ValidationError("Check your password.", { password: "That isn’t your password." });
  }
  throw error;
}

/** AU-02: replaces the recovery codes with 10 new ones (the old ones stop working), shown once. */
export async function newRecoveryCodesAction(_: ActionState, form: FormData): Promise<RecoveryCodesResult> {
  return runAction<RecoveryCodesResult>(async () => {
    await requireActor();
    const input = parseInput(confirmPasswordSchema, formToObject(form));
    try {
      const result = await getAuth().api.generateBackupCodes({
        body: { password: input.password || undefined },
        headers: await headers(),
      });
      return { ok: true, recoveryCodes: result.backupCodes };
    } catch (error) {
      passwordProblem(error);
    }
  });
}

/** AU-02: customers may turn the authenticator app off; sellers and admins must keep two-step. */
export async function turnOffAppAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    if (actor.role !== "CUSTOMER") throw new ForbiddenError("Sellers and admins can’t turn two-step sign-in off.");
    const input = parseInput(confirmPasswordSchema, formToObject(form));
    try {
      const result = await getAuth().api.disableTwoFactor({
        body: { password: input.password || undefined },
        headers: await headers(),
        returnHeaders: true,
      });
      await rememberReplacedSession(result.headers); // Better Auth gives this browser a fresh session
    } catch (error) {
      passwordProblem(error);
    }
    return { ok: true, message: "Two-step sign-in with an app is off." };
  });
}

/** Removes one of the signed-in person's own passkeys (Better Auth checks it is theirs). */
export async function removePasskeyAction(_: ActionState, form: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await requireActor();
    const input = parseInput(passkeyIdSchema, formToObject(form));
    try {
      await getAuth().api.deletePasskey({ body: { id: input.passkeyId }, headers: await headers() });
    } catch (error) {
      if (isAPIError(error)) throw new ValidationError("That passkey couldn’t be removed. Reload the page.");
      throw error;
    }
    return { ok: true, message: "Passkey removed." };
  });
}

/** After a passkey sign-in in the browser: goes where the person was going, only ever on this site. */
export async function afterPasskeySignIn(next: string): Promise<void> {
  redirect(safeNextPath(next));
}
