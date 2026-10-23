import { isNew } from "@/lib/catalogue";
import type { Product } from "@/lib/types";

type BadgeKind = "heritage" | "made-to-order" | "personalized" | "eco" | "new";

const labels: Record<BadgeKind, string> = {
  heritage: "Heritage craft",
  "made-to-order": "Made to order",
  personalized: "Personalized",
  eco: "Eco-friendly",
  new: "New",
};

// Heritage takes the lacquer colours; everything else stays neutral so it doesn't compete.
const styles: Record<BadgeKind, string> = {
  heritage: "bg-turmeric text-ink",
  "made-to-order": "bg-paper-raised/95 text-ink",
  personalized: "bg-paper-raised/95 text-ink",
  eco: "bg-paper-raised/95 text-forest",
  new: "bg-ink text-paper",
};

export function productBadges(p: Product): BadgeKind[] {
  const list: BadgeKind[] = [];
  if (p.isHeritage) list.push("heritage");
  if (isNew(p)) list.push("new");
  if (p.isCustomizable) list.push("personalized");
  else if (p.type === "MADE_TO_ORDER") list.push("made-to-order");
  if (p.isEcoFriendly && !p.isHeritage) list.push("eco");
  return list;
}

export function Badge({ kind }: { kind: BadgeKind }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-sm px-2 text-xs font-semibold ${styles[kind]}`}>
      {labels[kind]}
    </span>
  );
}

export function BadgeList({ product, max = 2 }: { product: Product; max?: number }) {
  const badges = productBadges(product).slice(0, max);
  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <Badge key={b} kind={b} />
      ))}
    </div>
  );
}
