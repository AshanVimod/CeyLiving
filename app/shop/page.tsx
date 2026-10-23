import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogueResults, CatalogueSkeleton } from "@/components/catalogue/catalogue-results";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Shop all",
  description: "Every handmade piece on CeyLiving, from Kolam masks to modern ceramics.",
};

export default function ShopAllPage(props: PageProps<"/shop">) {
  return (
    <Container className="pt-6 pb-10">
      <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "Shop all" }]} />
      <header className="mt-4 mb-10 max-w-2xl">
        <h1 className="text-[2.4rem] sm:text-[3rem]">Shop all</h1>
        <p className="mt-2 text-lg text-ink-soft">Every piece on CeyLiving, from traditional crafts to new design.</p>
      </header>
      <Suspense fallback={<CatalogueSkeleton />}>
        <CatalogueResults searchParams={props.searchParams} basePath="/shop" />
      </Suspense>
    </Container>
  );
}
