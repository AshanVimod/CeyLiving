import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/forms/auth-forms";
import { Container } from "@/components/ui/section-heading";
import { safeNextPath } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

async function Register({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const { seller, next } = await searchParams;
  const isSeller = seller === "1";
  // The seller path continues to the application form once the person has an account (D-04).
  return <RegisterForm seller={isSeller} next={safeNextPath(next, isSeller ? "/sell/apply" : "/account")} />;
}

export default function RegisterPage(props: PageProps<"/register">) {
  return (
    <Container className="pt-14">
      <Suspense fallback={<div className="mx-auto h-96 max-w-md" />}>
        <Register searchParams={props.searchParams} />
      </Suspense>
    </Container>
  );
}
