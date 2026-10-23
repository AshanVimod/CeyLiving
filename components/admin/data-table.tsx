import Link from "next/link";

/** Simple accessible table: caption, header cells with scope, and horizontal scroll inside its own box on phones. */
export function DataTable({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-x-auto rounded-lg border border-line bg-paper-raised"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full min-w-[640px] text-left text-[0.95rem]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-sage/60 text-sm">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

/** Filter chips that are plain links, so filters live in the URL and survive reloads. */
export function FilterLinks({
  items,
  current,
  label = "Filter",
}: {
  items: { value: string; label: string; href: string }[];
  current: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="mb-5">
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.value}>
            <Link
              href={i.href}
              aria-current={i.value === current ? "true" : undefined}
              className="inline-flex min-h-10 items-center rounded-full border border-line bg-paper-raised px-4 text-sm hover:border-ink-soft aria-[current=true]:border-forest aria-[current=true]:bg-forest aria-[current=true]:text-paper"
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
