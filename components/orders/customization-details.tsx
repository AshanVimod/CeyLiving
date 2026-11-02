/** BR-16: what the customer asked the maker for, shown as plain text under the order line. */
export function CustomizationDetails({ customization }: { customization?: Record<string, string> }) {
  const entries = Object.entries(customization ?? {});
  if (!entries.length) return null;
  return (
    <dl className="mt-1 w-full space-y-0.5 text-sm text-ink-soft">
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-wrap gap-x-1.5">
          <dt className="font-medium text-ink">{label}:</dt>
          <dd className="break-words whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
