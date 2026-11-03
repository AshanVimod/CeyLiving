import { resizedUploadUrl } from "./photos";

type LoaderArgs = { src: string; width: number; quality?: number };

/**
 * Uploaded photos (B09) come in fixed widths (400, 800, 1600 WebP): pick the smallest that covers the slot.
 * Seed photos ask the Unsplash CDN for a resized, modern-format copy instead of the full original.
 */
export default function imageLoader({ src, width, quality }: LoaderArgs): string {
  const upload = resizedUploadUrl(src, width);
  if (upload) return upload;
  if (src.startsWith("/")) return src;
  const url = new URL(src);
  url.searchParams.set("auto", "format");
  url.searchParams.set("fit", "max");
  url.searchParams.set("w", String(width));
  url.searchParams.set("q", String(quality ?? 72));
  return url.href;
}
