import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoAccountsPanel } from "@/components/account/demo-accounts-panel";
import { SignInForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";
import { currentUser, safeNextPath } from "@/lib/server/auth";
import { isProductionRuntime } from "@/lib/server/store/dev-store";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

async function SignInContent({ searchParams }: { searchParams: PageProps<"/signin">["searchParams"] }) {
  const { next, deleted } = await searchParams;
  const nextPath = safeNextPath(next);
  const user = await currentUser();
  return (
    <>
      {deleted === "1" ? (
        <p role="status" className="mx-auto mb-8 max-w-md rounded-md bg-sage px-4 py-3">
          Your account was deleted and you’ve been signed out. Thank you for shopping with CeyLiving.
        </p>
      ) : null}
      <SignInForm next={nextPath} signedInAs={user?.name} />
      {isProductionRuntime() ? null : <DemoAccountsPanel next={nextPath} currentUserId={user?.id} />}
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
