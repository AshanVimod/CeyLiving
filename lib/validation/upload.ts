import { z } from "zod";
import { UPLOAD_LIMITS } from "@/lib/config";
import { UPLOAD_ID } from "@/lib/photos";
import type { UploadPurpose } from "@/lib/types";

// B09 (backend plan 11.1 step 1, SEC-07): what the browser may ask for. The declared type and size are checked
// here, bound into the upload address, and checked again on the real file by image.process.

export const UPLOAD_PURPOSES = [
  "PRODUCT_IMAGE",
  "SHOP_LOGO",
  "SHOP_BANNER",
  "APPLICATION_PHOTO",
] as const satisfies readonly UploadPurpose[];

export const uploadRequestSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES, { error: "Choose where the photo goes." }),
  contentType: z.enum(UPLOAD_LIMITS.types, { error: "Choose a JPEG, PNG or WebP photo." }),
  sizeBytes: z.coerce
    .number({ error: "Choose a photo." })
    .int()
    .min(1, "That file is empty.")
    .max(UPLOAD_LIMITS.maxBytes, "Choose a photo under 8 MB."),
});

export const uploadIdSchema = z.object({
  uploadId: z.string().regex(UPLOAD_ID, "We couldn’t find that photo."),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;
