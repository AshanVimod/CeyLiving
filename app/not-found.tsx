import Link from "next/link";
import { SearchBox } from "@/components/layout/search-box";
import { Container } from "@/components/ui/section-heading";

export default function NotFound() {
  return (
    <Container className="max-w-2xl pt-20 text-center">
      <h1 className="text-[2.4rem] sm:text-[3rem]">We couldn’t find that page</h1>
      <p className="mt-3 text-lg text-ink-soft">The piece may have sold, or the link may be wrong. Try a search instead.</p>
      <div className="mt-8 text-left">
        <SearchBox size="large" />
      </div>
      <Link href="/shop" className="mt-8 inline-flex h-12 items-center rounded-full border border-ink/25 px-7 font-semibold hover:border-ink">
        Browse everything
      </Link>
    </Container>
  );
}
