import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CatalogueResults, CatalogueSkeleton } from "@/components/catalogue/catalogue-results";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section-heading";
import { categories, getCategory } from "@/lib/data/categories";
import { photoUrl } from "@/lib/format";

export function generateStaticParams() {
  return categories.map((c) => ({ categorySlug: c.slug }));
}

export async function generateMetadata(props: PageProps<"/c/[categorySlug]">): Promise<Metadata> {
  const { categorySlug } = await props.params;
  const category = getCategory(categorySlug);
  return category ? { title: category.name, description: category.blurb } : {};
}

export default function CategoryPage(props: PageProps<"/c/[categorySlug]">) {
  return (
    <Suspense
      fallback={
        <Container className="pt-6 pb-10">
          <div className="skeleton mb-10 h-40 rounded-md" />
          <CatalogueSkeleton />
        </Container>
      }
    >
      <CategoryContent {...props} />
    </Suspense>
  );
}

async function CategoryContent(props: PageProps<"/c/[categorySlug]">) {
  const { categorySlug } = await props.params;
  const category = getCategory(categorySlug);
  if (!category) notFound();
  const traditional = category.group === "TRADITIONAL";

  return (
    <>
      {traditional ? <div className="lacquer-band" aria-hidden="true" /> : null}
      <Container className="pt-6 pb-10">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { href: "/shop", label: "Shop all" }, { label: category.name }]} />
        <header className="mt-5 mb-10 flex items-center gap-6 sm:gap-8">
          <div className={`relative hidden h-32 w-26 shrink-0 overflow-hidden bg-sage sm:block ${traditional ? "arch" : "rounded-[3px]"}`}>
            <Image src={photoUrl(category.photo.id)} alt="" fill sizes="104px" className="object-cover" priority />
          </div>
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-ink-soft">{traditional ? "Traditional crafts" : "Modern design"}</p>
            <h1 className="mt-1 text-[2.3rem] sm:text-[3rem]">{category.name}</h1>
            {category.sinhala ? (
              <p lang="si" className="font-sinhala text-ink-soft">
                {category.sinhala}
              </p>
            ) : null}
            <p className="mt-2 text-lg text-ink-soft">{category.blurb}</p>
          </div>
        </header>
        <ul className="mb-8 flex flex-wrap gap-2" aria-label="Subcategories">
          {category.subcategories.map((s) => (
            <li key={s}>
              <Link
                href={`/search?q=${encodeURIComponent(s)}&category=${category.slug}`}
                className="inline-flex min-h-10 items-center rounded-full border border-line bg-paper-raised px-4 text-sm hover:border-ink-soft"
              >
                {s}
              </Link>
            </li>
          ))}
        </ul>
        <Suspense fallback={<CatalogueSkeleton />}>
          <CatalogueResults searchParams={props.searchParams} category={category.slug} basePath={`/c/${category.slug}`} />
        </Suspense>
      </Container>
    </>
  );
}
