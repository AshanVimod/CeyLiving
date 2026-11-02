import type { Metadata } from "next";
import { Suspense } from "react";
import { TwoStepSignInForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";
import { safeNextPath } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Enter your code", robots: { index: false } };

/**
 * AU-02: the second step of signing in, after the password. Better Auth's short-lived cookie says whose sign-in
 * this is; without it the code is refused and the person signs in again.
 */
async function Content({ searchParams }: { searchParams: PageProps<"/signin/two-step">["searchParams"] }) {
  const { next } = await searchParams;
  return <TwoStepSignInForm next={safeNextPath(next)} />;
}

export default function TwoStepSignInPage(props: PageProps<"/signin/two-step">) {
  return (
    <Container className="pt-14">
      <Suspense fallback={<div className="mx-auto h-80 max-w-md" />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}
