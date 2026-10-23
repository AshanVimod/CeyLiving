import { getEnv } from "@/lib/env";

/** Feature-02 public demo: shown on every page when DEMO_MODE=true, so testers know nothing here is real. */
export function DemoBanner() {
  const { DEMO_MODE, FEEDBACK_URL } = getEnv();
  if (!DEMO_MODE) return null;
  return (
    <aside aria-label="Demo version" className="border-b border-turmeric/40 bg-turmeric-soft text-ink">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-4 py-2 text-center text-sm sm:px-6">
        <p>
          <strong className="font-semibold">Demo version</strong> — data resets regularly, no real payments. Don’t enter
          real personal details.
        </p>
        {FEEDBACK_URL ? (
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center rounded-md bg-forest px-3 font-semibold text-paper transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            Give feedback<span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </aside>
  );
}
