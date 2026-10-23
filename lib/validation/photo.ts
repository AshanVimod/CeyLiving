import { z } from "zod";

// Until real uploads exist (SEC-07), photos are links to the image CDN the site already trusts.
// Only https://images.unsplash.com/photo-… addresses are accepted, so no other host can be embedded.
const CDN_PHOTO = /^https:\/\/images\.unsplash\.com\/photo-([A-Za-z0-9-]{6,80})(?:[?#].*)?$/;

export function photoIdFromUrl(url: string): string | undefined {
  return CDN_PHOTO.exec(url.trim())?.[1];
}

export const photoUrl = z
  .string({ error: "Paste a photo link." })
  .trim()
  .refine((u) => Boolean(photoIdFromUrl(u)), "Use a photo link that starts with https://images.unsplash.com/photo-");

export const photoInput = z.object({
  url: photoUrl,
  alt: z
    .string()
    .trim()
    .min(3, "Describe the photo in a few words (for people using screen readers).")
    .max(160, "Keep the description under 160 characters."),
});

export type PhotoInput = z.infer<typeof photoInput>;
