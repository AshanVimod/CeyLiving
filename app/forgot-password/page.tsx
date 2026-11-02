import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";
import { turnstileSiteKey } from "@/lib/server/turnstile";

export const metadata: Metadata = { title: "Forgot your password", robots: { index: false } };

async function Form() {
  return <ForgotPasswordForm turnstileSiteKey={await turnstileSiteKey()} />;
}

/** B05a (AU-07): the answer is the same whether or not the email has an account. B05b (AU-06): with Turnstile. */
export default function ForgotPasswordPage() {
  return (
    <Container className="pt-14">
      <Suspense fallback={<div className="mx-auto h-80 max-w-md" />}>
        <Form />
      </Suspense>
    </Container>
  );
}
