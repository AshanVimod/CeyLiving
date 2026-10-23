import Image from "next/image";
import Link from "next/link";
import { productCountByCategory } from "@/lib/server/catalogue";
import { photoUrl } from "@/lib/format";
import type { Category } from "@/lib/types";

/** Traditional crafts get the arch and a larger tile; modern design keeps square corners. */
export function TraditionalTile({ category }: { category: Category }) {
  const count = productCountByCategory(category.slug);
  return (
    <Link href={`/c/${category.slug}`} className="group block rounded-sm">
      <div className="arch relative aspect-[3/4] overflow-hidden bg-sage">
        <Image
          src={photoUrl(category.photo.id)}
          alt=""
          fill
          sizes="(min-width: 1024px) 300px, 45vw"
          className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.05]"
        />
      </div>
      <h3 className="mt-3 font-display text-xl leading-tight group-hover:text-forest">{category.name}</h3>
      {category.sinhala ? (
        <p lang="si" className="font-sinhala text-sm text-ink-soft">
          {category.sinhala}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-ink-soft">
        {count} {count === 1 ? "piece" : "pieces"}
      </p>
    </Link>
  );
}

export function ModernTile({ category }: { category: Category }) {
  return (
    <Link href={`/c/${category.slug}`} className="group block rounded-sm">
      <div className="relative aspect-square overflow-hidden rounded-[3px] bg-sage">
        <Image
          src={photoUrl(category.photo.id)}
          alt=""
          fill
          sizes="(min-width: 1024px) 150px, (min-width: 640px) 22vw, 45vw"
          className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.05]"
        />
      </div>
      <h3 className="mt-2.5 font-sans text-[0.95rem] font-medium leading-snug group-hover:text-forest">
        {category.name}
      </h3>
    </Link>
  );
}
