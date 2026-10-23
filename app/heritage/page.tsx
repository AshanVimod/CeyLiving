import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ProductGrid } from "@/components/product/product-card";
import { Container } from "@/components/ui/section-heading";
import { publicCatalogue } from "@/lib/server/catalogue";
import { photoUrl } from "@/lib/format";

export const metadata: Metadata = {
  title: "Traditional Sri Lanka",
  description: "Kolam masks, Beeralu lace, Dumbara weaving, batik and coconut shell craft, from the families who keep them alive.",
};

const crafts = [
  {
    name: "Kolam and Raksha masks",
    sinhala: "වෙස් මුහුණු",
    place: "Ambalangoda, Galle district",
    text: "Carved from light kaduru wood and painted in layers, the masks of the southern coast were made for Kolam folk drama and healing rituals. Raksha masks show demons: the cobra Naga, the bird Gurulu, the peacock Mayura.",
    photo: { id: "1720945489949-2323f3f2f8bc", alt: "Wall covered with painted wooden masks" },
    href: "/c/wood-carvings",
  },
  {
    name: "Beeralu lace",
    sinhala: "බීරළු",
    place: "Galle and Weligama",
    text: "Bobbin lace arrived with the Portuguese in the 16th century and became a southern craft of its own. The maker pins a pattern to a round cushion and crosses dozens of wooden bobbins to build the lace.",
    photo: { id: "1769420295409-ce777445e57b", alt: "Delicate white lace on a pink background" },
    href: "/c/handloom-batik-lace",
  },
  {
    name: "Dumbara weaving",
    sinhala: "දුම්බර",
    place: "Dumbara valley, Kandy district",
    text: "Weavers in the Dumbara valley make mats and wall hangings from hana fibre, dyed and woven into geometric motifs: animals, temple designs and the diamond borders that run along the top of this page.",
    photo: { id: "1714245145426-c8565109aa34", alt: "Close-up of an old wooden loom" },
    href: "/c/sri-lankan-handicrafts",
  },
  {
    name: "Batik",
    sinhala: "බතික්",
    place: "Kandy and the hill country",
    text: "Designs are drawn in hot wax on cotton or silk, then dyed, waxed again and dyed again, from light to dark. Boiling removes the wax and leaves the fine crackle that marks hand batik.",
    photo: { id: "1761516659497-8478e39d2b26", alt: "Batik fabric with floral and bird patterns" },
    href: "/c/handloom-batik-lace",
  },
  {
    name: "Coconut shell craft",
    sinhala: "පොල් කටු",
    place: "Matara and the south",
    text: "Shells left over from coconut mills are cut, sanded and polished into bowls, spoons and figures. No varnish, only coconut oil.",
    photo: { id: "1743669768815-7892ba1b3090", alt: "Coconut shells arranged as an owl" },
    href: "/c/sri-lankan-handicrafts",
  },
];

export default function HeritagePage() {
  const heritage = publicCatalogue().filter((p) => p.isHeritage).slice(0, 8);
  return (
    <>
      <section className="dumbara border-b border-line">
        <div className="lacquer-band" aria-hidden="true" />
        <Container className="grid items-end gap-10 py-14 sm:py-20 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h1 className="text-[2.6rem] leading-[1.06] sm:text-[3.6rem]">Traditional Sri Lanka</h1>
            <p className="mt-5 max-w-xl text-lg text-ink-soft">
              Some of these crafts are over five hundred years old. They survive because families keep teaching them. Buying
              here pays the maker directly, at the price they set.
            </p>
          </div>
          <p className="max-w-md text-ink-soft lg:justify-self-end">
            Heritage crafts carry the turmeric label and the lacquer band across CeyLiving, so you can tell a traditional
            technique from a modern design at a glance.
          </p>
        </Container>
      </section>

      <Container className="mt-16 space-y-20 sm:space-y-28">
        {crafts.map((c, i) => (
          <article key={c.name} className={`grid items-center gap-8 md:grid-cols-2 md:gap-14 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`}>
            <div className="arch relative aspect-[4/5] max-h-[560px] overflow-hidden bg-sage">
              <Image src={photoUrl(c.photo.id)} alt={c.photo.alt} fill sizes="(min-width: 768px) 45vw, 92vw" className="object-cover" />
            </div>
            <div className="max-w-lg">
              <p lang="si" className="font-sinhala text-lg text-lacquer">
                {c.sinhala}
              </p>
              <h2 className="mt-1 text-[2rem] sm:text-[2.5rem]">{c.name}</h2>
              <p className="mt-1 text-ink-soft">{c.place}</p>
              <p className="mt-5 text-lg leading-relaxed">{c.text}</p>
              <Link
                href={c.href}
                className="mt-6 inline-flex h-11 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink hover:bg-paper-raised"
              >
                Shop {c.name.toLowerCase()}
              </Link>
            </div>
          </article>
        ))}
      </Container>

      <Container className="mt-24">
        <h2 className="mb-8 text-[1.85rem] sm:text-[2.25rem]">Heritage pieces for sale now</h2>
        <ProductGrid products={heritage} morph />
      </Container>
    </>
  );
}
