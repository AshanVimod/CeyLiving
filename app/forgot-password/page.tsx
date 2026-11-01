import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Forgot your password", robots: { index: false } };

/** B05a (AU-07): the answer is the same whether or not the email has an account. */
export default function ForgotPasswordPage() {
  return (
    <Container className="pt-14">
      <ForgotPasswordForm />
    </Container>
  );
}
