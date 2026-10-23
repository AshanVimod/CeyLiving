import { StarIcon } from "../ui/icons";

/** Stars plus average and count. Without a count it renders a single review's stars. */
export function Rating({ average, count, size = 14 }: { average: number; count?: number; size?: number }) {
  const rounded = Math.round(average * 2) / 2;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
      <span className="flex text-turmeric" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <StarIcon key={i} size={size} filled={i <= rounded} className={i <= rounded ? "" : "text-line"} />
        ))}
      </span>
      {count === undefined ? (
        <span className="sr-only">Rated {average} out of 5</span>
      ) : (
        <span className="tabular-nums">
          <span className="sr-only">Rated </span>
          {average.toFixed(1)}
          <span className="sr-only"> out of 5</span> ({count} {count === 1 ? "review" : "reviews"})
        </span>
      )}
    </span>
  );
}
