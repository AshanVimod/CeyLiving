"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 pt-20 text-center">
      <h1 className="text-[2.2rem]">This page didn’t load</h1>
      <p className="mt-3 text-lg text-ink-soft">Something went wrong on our side. Try again, or go back to the home page.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="h-12 rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep">
          Try again
        </button>
        <Link href="/" className="inline-flex h-12 items-center rounded-full border border-ink/25 px-7 font-semibold hover:border-ink">
          Home page
        </Link>
      </div>
    </div>
  );
}
