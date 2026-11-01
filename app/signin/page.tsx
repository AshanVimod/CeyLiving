import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoAccountsPanel } from "@/components/account/demo-accounts-panel";
import { SignInForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";
import { currentUser, safeNextPath } from "@/lib/server/auth";
import { demoSignInAllowed } from "@/lib/server/better-auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

async function SignInContent({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { next, deleted, reset, signedOut } = await searchParams;
  const nextPath = safeNextPath(next);
  const user = await currentUser();
  return (
    <>
      {deleted === "1" ? (
        <p role="status" className="mx-auto mb-8 max-w-md rounded-md bg-sage px-4 py-3">
          Your account was deleted and you’ve been signed out. Thank you for shopping with CeyLiving.
        </p>
      ) : null}
      <SignInForm
        next={nextPath}
        signedInAs={user?.name}
        notice={
          reset === "1"
            ? "Your new password is saved, and you’ve been signed out everywhere. Sign in with it now."
            : signedOut === "everywhere"
              ? "You’ve been signed out on every device."
              : undefined
        }
      />
      {demoSignInAllowed() ? <DemoAccountsPanel next={nextPath} currentUserId={user?.id} /> : null}
    </>
  );
}

export default function SignInPage(props: PageProps<"/signin">) {
  return (
    <Container className="pt-14">
      <Suspense fallback={<SignInForm next="/account" />}>
        <SignInContent searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}
