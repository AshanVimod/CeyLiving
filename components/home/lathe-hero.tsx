import Image from "next/image";
import Link from "next/link";
import { formatLkr, photoUrl } from "@/lib/format";

// Bands copied from the stripes on turned Laksha lacquerware: ink, turmeric, lacquer red.
const RINGS = [
  { r: 186, w: 7, color: "var(--color-ink)", delay: 0.15 },
  { r: 198, w: 9, color: "var(--color-turmeric)", delay: 0.28 },
  { r: 213, w: 13, color: "var(--color-lacquer)", delay: 0.41 },
  { r: 226, w: 4, color: "var(--color-turmeric)", delay: 0.54 },
  { r: 235, w: 3, color: "var(--color-ink)", delay: 0.64 },
  { r: 248, w: 1, color: "var(--color-ink-soft)", delay: 0.74 },
];

interface LatheHeroProps {
  photoId: string;
  alt: string;
  caption: { title: string; maker: string; place: string; priceCents: number; href: string };
}

/** The site's single orchestrated load moment: lacquer bands draw in like wood turning on a lathe. */
export function LatheHero({ photoId, alt, caption }: LatheHeroProps) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[540px]">
      <svg viewBox="0 0 520 520" className="absolute inset-0 size-full" aria-hidden="true" focusable="false">
        <g className="lathe-spin">
          {RINGS.map((ring) => {
            const len = Math.ceil(2 * Math.PI * ring.r);
            return (
              <circle
                key={ring.r}
                cx="260"
                cy="260"
                r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={ring.w}
                className="lathe-ring"
                style={{ "--len": len, "--delay": `${ring.delay}s` } as React.CSSProperties}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-[14.6%] overflow-hidden rounded-full bg-sage">
        <Image
          src={photoUrl(photoId)}
          alt={alt}
          fill
          priority
          sizes="(min-width: 1024px) 380px, 70vw"
          className="hero-photo object-cover"
        />
      </div>
      <Link
        href={caption.href}
        className="fade-late group absolute bottom-[3%] left-0 flex max-w-[260px] items-center gap-3 rounded-md border border-line bg-paper-raised/95 py-2.5 pl-3 pr-4 shadow-[0_16px_36px_-20px_rgb(19_36_28/0.55)] backdrop-blur-sm sm:left-[-2%]"
        style={{ "--delay": "1.15s" } as React.CSSProperties}
      >
        <span
          className="h-9 w-1.5 shrink-0 rounded-full [background:linear-gradient(to_bottom,var(--color-ink)_0_20%,var(--color-turmeric)_20%_40%,var(--color-lacquer)_40%_75%,var(--color-turmeric)_75%_85%,var(--color-ink)_85%)]"
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="block truncate font-medium leading-tight group-hover:underline underline-offset-4">
            {caption.title}
          </span>
          <span className="block truncate text-sm text-ink-soft">
            {caption.maker}, {caption.place}
          </span>
          <span className="block text-sm font-semibold tabular-nums">From {formatLkr(caption.priceCents)}</span>
        </span>
      </Link>
    </div>
  );
}
