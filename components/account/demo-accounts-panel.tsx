import { signInAsDemo } from "@/lib/server/actions/session";
import { DEMO_ACCOUNTS } from "@/lib/server/store/seed";

/** Development only (D-05): sign in as a seeded account without the browser console. */
export function DemoAccountsPanel({ next, currentUserId }: { next: string; currentUserId?: string }) {
  return (
    <section
      aria-labelledby="demo-heading"
      className="mx-auto mt-10 max-w-md rounded-lg border border-dashed border-ink/25 bg-paper-raised p-5"
    >
      <h2 id="demo-heading" className="font-sans text-base font-semibold">
        Demo accounts
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Development only. Pick an account to see what each role can do. Not shown in production.
      </p>
      <ul className="mt-4 grid gap-2">
        {DEMO_ACCOUNTS.map((account) => (
          <li key={account.id}>
            <form action={signInAsDemo}>
              <input type="hidden" name="userId" value={account.id} />
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                aria-current={account.id === currentUserId ? "true" : undefined}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-line bg-paper px-4 py-2 text-left transition-colors hover:border-forest aria-[current=true]:border-forest aria-[current=true]:bg-sage"
              >
                <span>
                  <span className="block font-medium">{account.label}</span>
                  <span className="block text-sm text-ink-soft">{account.note}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-forest">
                  {account.id === currentUserId ? "Signed in" : "Use"}
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
