import Link from "next/link";
import { Suspense } from "react";
import { CategoriesMenu } from "./categories-menu";
import { HeaderActions } from "./header-actions";
import { HeaderAuth, MobileAccountLinks } from "./header-auth";
import { HeaderAuthPlaceholder } from "./header-auth-view";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NAV_LINKS } from "./nav-links";
import { SearchBox } from "./search-box";
import { OPEN_A_SHOP, SellLink, SellLinkView } from "./sell-link";

const sellLinkClass =
  "ml-auto rounded-sm py-2 font-medium text-forest underline decoration-forest/30 underline-offset-[6px] transition-colors hover:decoration-forest";
const mobileSellLinkClass =
  "flex h-12 items-center justify-center rounded-full border border-forest font-semibold text-forest hover:bg-forest hover:text-paper";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-sm supports-[backdrop-filter]:bg-paper/85">
      <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 pt-2 pb-2 sm:px-6 lg:gap-8 lg:pt-3 lg:pb-1">
        <div className="-ml-2 lg:hidden">
          <MobileMenu
            account={
              <Suspense fallback={null}>
                <MobileAccountLinks />
              </Suspense>
            }
            sellLink={
              <Suspense fallback={<SellLinkView target={OPEN_A_SHOP} className={mobileSellLinkClass} />}>
                <SellLink className={mobileSellLinkClass} />
              </Suspense>
            }
          />
        </div>
        <Logo />
        <div className="hidden flex-1 lg:block lg:max-w-xl">
          <SearchBox />
        </div>
        {/* The session is read on the server; the placeholder holds its space so nothing signed-out flashes. */}
        <div className="ml-auto -mr-2 flex items-center gap-2">
          <Suspense fallback={<HeaderAuthPlaceholder />}>
            <HeaderAuth />
          </Suspense>
          <HeaderActions />
        </div>
      </div>
      <div className="px-4 pb-2.5 sm:px-6 lg:hidden">
        <SearchBox />
      </div>
      <nav
        aria-label="Main"
        className="mx-auto hidden max-w-[1320px] items-center gap-7 px-6 pb-1.5 text-[0.95rem] lg:flex"
      >
        <CategoriesMenu />
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-sm py-2 text-ink-soft transition-colors hover:text-ink">
            {l.label}
          </Link>
        ))}
        <Suspense fallback={<SellLinkView target={OPEN_A_SHOP} className={sellLinkClass} />}>
          <SellLink className={sellLinkClass} />
        </Suspense>
      </nav>
    </header>
  );
}
