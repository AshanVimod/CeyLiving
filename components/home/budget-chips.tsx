import Link from "next/link";
import { Container } from "@/components/ui/section-heading";
import { lowestPriceCents, type CatalogueProduct } from "@/lib/catalogue";
import { PRICE_CHIPS } from "@/lib/config";

function priceChipCount(products: CatalogueProduct[], min?: number, max?: number) {
  return products.filter((p) => {
    const price = lowestPriceCents(p);
    return (min === undefined || price >= min) && (max === undefined || price <= max);
  }).length;
}

/** Home page: "Shop to your budget" price ranges with a live count of pieces in each. */
export function BudgetChips({ products }: { products: CatalogueProduct[] }) {
  return (
    <section aria-labelledby="budget-heading" className="mt-24">
      <Container>
        <div className="rounded-lg bg-sage px-5 py-10 sm:px-10 sm:py-12">
          <h2 id="budget-heading" className="text-[1.85rem] sm:text-[2.25rem]">
            Shop to your budget
          </h2>
          <p className="mt-2 max-w-xl text-ink-soft">Pick a price range, or set your own on the shop page.</p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {PRICE_CHIPS.map((chip) => {
              const params = new URLSearchParams();
              if (chip.minPrice !== undefined) params.set("minPrice", String(chip.minPrice));
              if (chip.maxPrice !== undefined) params.set("maxPrice", String(chip.maxPrice));
              return (
                <li key={chip.label}>
                  <Link
                    href={`/shop?${params.toString()}`}
                    className="group flex h-full items-center justify-between gap-4 rounded-md border border-ink/15 bg-paper-raised px-5 py-5 transition-[border-color,transform] duration-200 hover:border-forest active:scale-[0.99]"
                  >
                    <span>
                      <span className="block font-display text-xl">{chip.label}</span>
                      <span className="text-sm text-ink-soft">
                        {priceChipCount(products, chip.minPrice, chip.maxPrice)} pieces
                      </span>
                    </span>
                    <span
                      className="grid size-10 place-items-center rounded-full bg-forest text-paper transition-transform duration-300 group-hover:translate-x-1"
                      aria-hidden="true"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </Container>
    </section>
  );
}
