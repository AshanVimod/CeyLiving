import { Container } from "../ui/section-heading";
import { SectionNav, type NavItem } from "./section-nav";

/** Shared layout for /account, /seller and /admin: title, section nav and the page. */
export function AreaShell({
  title,
  navLabel,
  items,
  exact,
  children,
}: {
  title: string;
  navLabel: string;
  items: NavItem[];
  exact?: string[];
  children: React.ReactNode;
}) {
  return (
    <Container className="pt-8 pb-10">
      <p className="font-display text-2xl text-ink-soft">{title}</p>
      <div className="mt-5 grid gap-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-10">
        <SectionNav items={items} label={navLabel} exact={exact} />
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}

export function AreaSkeleton() {
  return (
    <Container className="pt-8 pb-10" aria-busy="true">
      <div className="skeleton h-8 w-40 rounded-sm" />
      <div className="mt-5 grid gap-6 md:grid-cols-[210px_1fr] md:gap-10">
        <div className="skeleton h-11 rounded-sm md:h-64" />
        <div className="space-y-4">
          <div className="skeleton h-10 w-2/3 rounded-sm" />
          <div className="skeleton h-40 rounded-lg" />
          <div className="skeleton h-40 rounded-lg" />
        </div>
      </div>
    </Container>
  );
}

export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-[2rem] sm:text-[2.4rem]">{title}</h1>
        {description ? <p className="mt-2 text-ink-soft">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <h2 className="text-xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-ink-soft">{text}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
