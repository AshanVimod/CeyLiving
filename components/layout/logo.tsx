import Link from "next/link";

/** Three lacquer rings, the same bands that frame the home page hero. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--color-ink)" strokeWidth="3" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="var(--color-turmeric)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="7.5" fill="none" stroke="var(--color-lacquer)" strokeWidth="3" />
      <circle cx="16" cy="16" r="3.5" fill="var(--color-forest)" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-sm" aria-label="CeyLiving home">
      <LogoMark />
      <span className="font-display text-[1.45rem] leading-none tracking-tight text-ink">CeyLiving</span>
    </Link>
  );
}
