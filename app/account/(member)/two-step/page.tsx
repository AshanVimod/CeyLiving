import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/account/area-shell";
import { AuthenticatorApp, Passkeys } from "@/components/account/two-step-panels";
import { signOut } from "@/lib/server/actions/session";
import { requireUser, safeNextPath } from "@/lib/server/auth";
import { db } from "@/lib/server/db/tx";
import { twoStepStatusOf } from "@/lib/server/repositories/people";

export const metadata: Metadata = { title: "Two-step sign-in" };

const AREA: Record<string, string> = { SELLER: "your seller dashboard", ADMIN: "the admin panel" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-paper-raised p-5 sm:p-6">
      <h2 className="font-sans text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * AU-02: set up two-step sign-in: an authenticator app (with recovery codes) or a passkey. Sellers and admins are
 * sent here before /seller or /admin opens, with `next` saying where to go back to.
 */
async function TwoStep({ searchParams }: { searchParams: PageProps<"/account/two-step">["searchParams"] }) {
  const { next } = await searchParams;
  const user = await requireUser("/account/two-step");
  const back = safeNextPath(next, user.role === "SELLER" ? "/seller" : user.role === "ADMIN" ? "/admin" : "/account");
  const status = await twoStepStatusOf(db, user.id);
  // Already has a second step, but this session was opened with the password alone (for example before B05b).
  const signInAgain = user.needsTwoStep && (status.appEnabled || status.passkeys.length > 0);

  return (
    <>
      <PageTitle
        title="Two-step sign-in"
        description="A second step after your password, so a stolen password alone can’t open your account."
      />
      <div className="space-y-6">
        {user.needsTwoStep ? (
          <p role="status" className="rounded-md bg-sage px-4 py-3">
            {signInAgain
              ? `Sign in again with your passkey or authenticator code to open ${AREA[user.role]}.`
              : `Sellers and admins sign in with two steps. Set up an authenticator app or a passkey to open ${AREA[user.role]}.`}
          </p>
        ) : null}

        {signInAgain && status.appEnabled ? (
          <Card title="Sign in again">
            <p className="text-sm text-ink-soft">
              You’ll be asked for a code from your authenticator app after your password.
            </p>
            <form action={signOut} className="mt-4">
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-paper hover:bg-forest-deep"
              >
                Sign out and sign in again
              </button>
            </form>
          </Card>
        ) : null}

        <Card title="Authenticator app">
          {signInAgain && !status.appEnabled ? (
            <p className="text-sm text-ink-soft">Sign in with your passkey first to add an authenticator app.</p>
          ) : (
            <AuthenticatorApp
              enabled={status.appEnabled}
              recoveryCodesLeft={status.recoveryCodesLeft}
              hasPassword={status.hasPassword}
              canMakeCodes={!user.needsTwoStep}
              canTurnOff={user.role === "CUSTOMER" && !user.needsTwoStep}
              continueHref={back}
            />
          )}
        </Card>

        <Card title="Passkeys">
          <p className="mb-4 text-sm text-ink-soft">
            A passkey signs you in with your fingerprint, face or device PIN instead of a password, and counts as two
            steps on its own.
          </p>
          {signInAgain && !status.passkeys.length ? null : (
            <Passkeys passkeys={status.passkeys} signInNext={user.needsTwoStep ? back : undefined} />
          )}
        </Card>
      </div>
    </>
  );
}

export default function TwoStepPage(props: PageProps<"/account/two-step">) {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
      <TwoStep searchParams={props.searchParams} />
    </Suspense>
  );
}
