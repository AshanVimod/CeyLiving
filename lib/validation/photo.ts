import { z } from "zod";
import { UNSPLASH_ID, UPLOAD_ID } from "@/lib/photos";

// B09: forms send photo ids, never addresses. An id is an upload (upl_…), or an Unsplash id that was already saved
// on the item before (seed data). Services decide whether this person may use it (SEC-A2, assertPhotosUsable).

export const photoId = z
  .string({ error: "Add a photo." })
  .trim()
  .refine((id) => UPLOAD_ID.test(id) || UNSPLASH_ID.test(id), "Add a photo.");

export const photoInput = z.object({
  id: photoId,
  alt: z
    .string()
    .trim()
    .min(3, "Describe the photo in a few words (for people using screen readers).")
    .max(160, "Keep the description under 160 characters."),
});

export type PhotoInput = z.infer<typeof photoInput>;
