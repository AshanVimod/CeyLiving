// B09 (backend plan 11.1): photo ids and the addresses they are served from. Safe for browser code.
// A photo id is either an upload id (upl_<uuid>, a photo someone uploaded) or an Unsplash id (seed data and photos
// saved before B09). Product, shop and application rows store photo ids, never addresses.

export const UPLOAD_ID = /^upl_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const UNSPLASH_ID = /^[A-Za-z0-9-]{6,80}$/;

/** SEC-07: the widths image.process makes, smallest first. Never larger than the original. */
export const PHOTO_WIDTHS = [400, 800, 1600] as const;
export type PhotoWidth = (typeof PHOTO_WIDTHS)[number];

export const isUploadId = (id: string) => UPLOAD_ID.test(id);

/** Inlined at build time; the server checks the value in lib/env.ts. */
const imageBase = () => (process.env.NEXT_PUBLIC_IMAGE_BASE_URL || "/dev-uploads").replace(/\/+$/, "");

/** Where a public photo is served: our image domain for uploads, Unsplash for the rest. */
export function photoUrl(id: string): string {
  return isUploadId(id) ? `${imageBase()}/i/${id}/1600.webp` : `https://images.unsplash.com/photo-${id}`;
}

/** Application photos are private: only the applicant and admins can open them (app/uploads/private). */
export function applicationPhotoUrl(id: string): string {
  return isUploadId(id) ? `/uploads/private/${id}/1600.webp` : photoUrl(id);
}

/** An uploaded photo's address at another width (the image loader's job), or undefined for other addresses. */
export function resizedUploadUrl(src: string, width: number): string | undefined {
  const match = /^(.*\/(?:i|uploads\/private)\/upl_[0-9a-f-]{36}\/)(?:400|800|1600)\.webp$/.exec(src);
  if (!match) return undefined;
  const size = PHOTO_WIDTHS.find((w) => w >= width) ?? PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
  return `${match[1]}${size}.webp`;
}
