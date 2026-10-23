import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogueResults, CatalogueSkeleton } from "@/components/catalogue/catalogue-results";
import { SearchBox } from "@/components/layout/search-box";
import { Container } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false },
};

async function SearchHeading({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  return (
    <header className="mb-10 max-w-2xl">
      <h1 className="text-[2.2rem] sm:text-[2.8rem]">{query ? `Results for “${query}”` : "Search"}</h1>
      <div className="mt-5">
        <SearchBox defaultValue={query} size="large" key={query} />
      </div>
    </header>
  );
}

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <Container className="pt-8 pb-10">
      <Suspense fallback={<div className="mb-10 h-36" />}>
        <SearchHeading searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<CatalogueSkeleton />}>
        <CatalogueResults searchParams={props.searchParams} basePath="/search" />
      </Suspense>
    </Container>
  );
}
