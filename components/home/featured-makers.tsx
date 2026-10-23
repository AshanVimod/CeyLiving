import Image from "next/image";
import Link from "next/link";
import { Container, SectionHeading } from "@/components/ui/section-heading";
import { photoUrl } from "@/lib/format";
import type { Shop } from "@/lib/types";

/** Home page: the lead maker's portrait and quote, and a list of other makers with portraits. */
export function FeaturedMakers({ lead, others }: { lead?: Shop; others: Shop[] }) {
  if (!lead) return null;
  return (
    <section aria-labelledby="makers-heading" className="mt-24">
      <Container>
        <SectionHeading
          id="makers-heading"
          title="The people behind the work"
          description="Every shop is reviewed before it opens. Read the maker's story on each listing."
          link={{ href: "/makers", label: "Meet all makers" }}
        />
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <Link
            href={`/shop/${lead.slug}`}
            className="group grid gap-6 rounded-sm sm:grid-cols-[1fr_1.1fr] sm:items-end"
          >
            <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sage">
              <Image
                src={photoUrl(lead.portrait!.id)}
                alt={lead.portrait!.alt}
                fill
                sizes="(min-width: 1024px) 340px, (min-width: 640px) 45vw, 92vw"
                className="object-cover transition-transform duration-700 ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
              />
            </div>
            <div className="pb-2">
              <blockquote className="font-display text-2xl leading-snug sm:text-[1.7rem]">“{lead.quote}”</blockquote>
              <p className="mt-5 font-semibold">{lead.ownerName}</p>
              <p className="text-ink-soft">
                {lead.name}, {lead.district}
              </p>
              <p className="mt-4 text-ink-soft">
                {lead.craft}. Making since {lead.since}.
              </p>
              <span className="mt-5 inline-block font-semibold text-forest underline decoration-forest/30 underline-offset-[6px] group-hover:decoration-forest">
                Visit the shop
              </span>
            </div>
          </Link>
          <ul className="divide-y divide-line border-y border-line">
            {others.map((m) => (
              <li key={m.slug}>
                <Link href={`/shop/${m.slug}`} className="group flex items-center gap-4 py-4">
                  <span className="relative size-16 shrink-0 overflow-hidden rounded-full bg-sage">
                    <Image src={photoUrl(m.portrait!.id)} alt="" fill sizes="64px" className="object-cover" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold group-hover:text-forest">{m.ownerName}</span>
                    <span className="block text-sm text-ink-soft">
                      {m.craft}, {m.district}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
