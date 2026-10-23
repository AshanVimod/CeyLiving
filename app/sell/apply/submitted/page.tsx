import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = { title: "Application sent", robots: { index: false } };

export default function SubmittedPage() {
  return (
    <Container className="max-w-2xl pt-16 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-forest text-paper" aria-hidden="true">
        <CheckIcon size={28} />
      </span>
      <h1 className="mt-6 text-[2.4rem]">Application sent</h1>
      <p className="mt-3 text-lg text-ink-soft">
        Thank you. Our team will review it, usually within five working days. You’ll get a notification, and you can
        check the status on your profile at any time.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/account"
          className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep"
        >
          See application status
        </Link>
        <Link
          href="/shop"
          className="inline-flex h-12 items-center rounded-full border border-ink/25 px-7 font-semibold hover:border-ink"
        >
          Keep browsing
        </Link>
      </div>
    </Container>
  );
}
