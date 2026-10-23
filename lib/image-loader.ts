type LoaderArgs = { src: string; width: number; quality?: number };

/** Asks the image CDN for a resized, modern-format copy instead of the full original. */
export default function imageLoader({ src, width, quality }: LoaderArgs): string {
  if (src.startsWith("/")) return src;
  const url = new URL(src);
  url.searchParams.set("auto", "format");
  url.searchParams.set("fit", "max");
  url.searchParams.set("w", String(width));
  url.searchParams.set("q", String(quality ?? 72));
  return url.href;
}
