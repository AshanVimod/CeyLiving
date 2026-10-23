import Link from "next/link";

interface SectionHeadingProps {
  title: string;
  description?: string;
  link?: { href: string; label: string };
  id?: string;
  tone?: "light" | "dark";
}

export function SectionHeading({ title, description, link, id, tone = "light" }: SectionHeadingProps) {
  const muted = tone === "dark" ? "text-paper/75" : "text-ink-soft";
  const linkColor = tone === "dark" ? "text-turmeric-soft" : "text-forest";
  return (
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h2 id={id} className="text-[1.85rem] sm:text-[2.25rem]">
          {title}
        </h2>
        {description ? <p className={`mt-2 ${muted}`}>{description}</p> : null}
      </div>
      {link ? (
        <Link
          href={link.href}
          className={`shrink-0 font-semibold underline decoration-current/30 underline-offset-[6px] transition-colors hover:decoration-current ${linkColor}`}
        >
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1320px] px-4 sm:px-6 ${className}`}>{children}</div>;
}
