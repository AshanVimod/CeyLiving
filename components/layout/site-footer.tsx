import Link from "next/link";
import { categories } from "@/lib/data/categories";
import { LogoMark } from "./logo";

const columns = [
  {
    title: "Shop",
    links: [
      { href: "/shop", label: "Shop all" },
      { href: "/heritage", label: "Traditional Sri Lanka" },
      { href: "/custom", label: "Custom & personalized" },
      { href: "/makers", label: "Discover makers" },
    ],
  },
  {
    title: "Sell",
    links: [
      { href: "/sell", label: "Open a shop" },
      { href: "/sell#fees", label: "Fees and payouts" },
      { href: "/help#selling", label: "Seller help" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/help#delivery", label: "Delivery" },
      { href: "/help#returns", label: "Returns" },
      { href: "/help#payments", label: "Payments" },
      { href: "/help#contact", label: "Contact us" },
      { href: "/about", label: "About CeyLiving" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-forest-deep text-paper">
      <div className="lacquer-band" aria-hidden="true" />
      <div className="mx-auto grid max-w-[1320px] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.3fr_2fr]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5 rounded-sm">
            <span className="rounded-full bg-paper p-0.5">
              <LogoMark size={26} />
            </span>
            <span className="font-display text-2xl">CeyLiving</span>
          </Link>
          <p className="mt-4 max-w-sm text-paper/80">
            Original work from independent makers across Sri Lanka. Every shop is reviewed before it opens, and every
            listing shows who made it and what it is made of.
          </p>
          <h2 className="mt-8 mb-3 font-sans text-sm font-semibold text-paper">Categories</h2>
          <ul className="flex max-w-md flex-wrap gap-x-4 gap-y-1.5 text-sm text-paper/75">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/c/${c.slug}`} className="hover:text-paper hover:underline underline-offset-4">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className="mb-3 font-sans text-sm font-semibold">{col.title}</h2>
              <ul className="space-y-2 text-paper/80">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="inline-block py-0.5 hover:text-paper hover:underline underline-offset-4"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-paper/15">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-2 px-4 py-5 text-sm text-paper/70 sm:flex-row sm:justify-between sm:px-6">
          <p>© 2026 CeyLiving. Prices in Sri Lankan rupees.</p>
          <p>Photos: Unsplash contributors. Demo shops and products.</p>
        </div>
      </div>
    </footer>
  );
}
