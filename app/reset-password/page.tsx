import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

/**
 * B05a: the reset email's link goes through Better Auth (/api/auth/reset-password/<token>), which checks the token
 * and sends people here with it, or with ?error=INVALID_TOKEN when it has expired or was already used.
 */
async function Reset({ searchParams }: { searchParams: PageProps<"/reset-password">["searchParams"] }) {
  const { token, error } = await searchParams;
  if (typeof token !== "string" || !token || error) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="text-[2.4rem]">This link doesn’t work any more</h1>
        <p className="mt-4 text-ink-soft">Reset links work once, for 1 hour.</p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep"
        >
          Ask for a new link
        </Link>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}

export default function ResetPasswordPage(props: PageProps<"/reset-password">) {
  return (
    <Container className="pt-14">
      <Suspense fallback={<div className="mx-auto h-96 max-w-md" />}>
        <Reset searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}
