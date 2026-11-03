import "server-only";
import sharp, { type Metadata } from "sharp";
import { UPLOAD_LIMITS } from "@/lib/config";
import { PHOTO_WIDTHS } from "@/lib/photos";
import { db, withTx } from "../db/tx";
import { findUpload, markUploadReady, markUploadRejected } from "../repositories/uploads";
import { getStorage, processedKey, type Storage } from "../storage";

// image.process (backend plan 10.2, 11.1 step 4, SEC-07). Runs in the worker only (sharp is never loaded by the
// web app). Reads the original from the private bucket, checks what the file really is, makes WebP copies at
// 400/800/1600 and stores them, marks the upload READY or REJECTED, then deletes the original.
//   * Re-encoding writes no metadata (sharp keeps none unless asked), so EXIF, GPS and XMP never reach a copy.
//   * A file that isn't a usable photo is a REJECTED upload, not a failed job (no retries).
//   * A storage error throws, so pg-boss retries (JOB-04) with the original still in place.
//   * Idempotent (JOB-03): an upload that is no longer PENDING is left as it is; only its original is removed.

// One libvips thread per image and no decoded-image cache: the worker runs WORKER_CONCURRENCY jobs side by side
// and stays long-lived, so memory stays flat.
sharp.concurrency(1);
sharp.cache(false);

const FORMATS = new Set(["jpeg", "png", "webp"]);
const WEBP_QUALITY = 80;

export type ProcessResult =
  | { outcome: "ready"; width: number; height: number }
  | { outcome: "rejected"; reason: string }
  | { outcome: "skipped"; why: string };

class Unusable extends Error {}

/** SEC-07: what the bytes really are (not what the browser said), and whether the photo is a usable size. */
async function inspect(bytes: Buffer): Promise<{ width: number; height: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: UPLOAD_LIMITS.maxPixels, failOn: "error" }).metadata();
  } catch {
    throw new Unusable("That file isn’t a JPEG, PNG or WebP photo.");
  }
  if (!meta.format || !FORMATS.has(meta.format)) throw new Unusable("That file isn’t a JPEG, PNG or WebP photo.");
  // Sizes as the photo is shown (a phone photo taken sideways is stored rotated, with an orientation tag).
  const { width, height } = meta.autoOrient ?? meta;
  if (!width || !height) throw new Unusable("That file isn’t a JPEG, PNG or WebP photo.");
  if (Math.min(width, height) < UPLOAD_LIMITS.minSide) {
    throw new Unusable(`That photo is too small. Use one at least ${UPLOAD_LIMITS.minSide} pixels on each side.`);
  }
  if (Math.max(width, height) > UPLOAD_LIMITS.maxSide || width * height > UPLOAD_LIMITS.maxPixels) {
    throw new Unusable("That photo is too large. Use one under 40 megapixels.");
  }
  return { width, height };
}

/** The WebP copies, each no wider than the original. No metadata is copied (no withMetadata/keepExif). */
async function encode(bytes: Buffer): Promise<{ width: number; body: Buffer }[]> {
  const source = sharp(bytes, { limitInputPixels: UPLOAD_LIMITS.maxPixels, failOn: "error" }).autoOrient();
  try {
    return await Promise.all(
      PHOTO_WIDTHS.map(async (width) => ({
        width,
        body: await source
          .clone()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer(),
      })),
    );
  } catch {
    // The header looked fine but the image data is broken (e.g. a cut-off file).
    throw new Unusable("That photo couldn’t be read. It may be damaged; try another copy.");
  }
}

export async function processUpload(
  uploadId: string,
  now = new Date(),
  storage: Storage = getStorage(),
): Promise<ProcessResult> {
  const upload = await findUpload(db, uploadId);
  if (!upload) return { outcome: "skipped", why: "missing" };
  if (upload.status !== "PENDING") {
    // Finished on an earlier run; make sure its original is gone (an earlier delete may have failed).
    await storage.deletePrivate(upload.storageKey);
    return { outcome: "skipped", why: upload.status.toLowerCase() };
  }
  if (!upload.confirmedAt) return { outcome: "skipped", why: "not confirmed" };

  const reject = async (reason: string): Promise<ProcessResult> => {
    await withTx((tx) => markUploadRejected(tx, upload.id, reason, now));
    await storage.deletePrivate(upload.storageKey);
    return { outcome: "rejected", reason };
  };

  const fetched = await storage.getPrivate(upload.storageKey, UPLOAD_LIMITS.maxBytes);
  if (fetched.kind === "missing") return reject("The photo didn’t arrive. Upload it again.");
  if (fetched.kind === "too-large") return reject("That photo is larger than 8 MB.");

  let size: { width: number; height: number };
  let copies: { width: number; body: Buffer }[];
  try {
    size = await inspect(fetched.bytes);
    copies = await encode(fetched.bytes);
  } catch (error) {
    if (error instanceof Unusable) return reject(error.message);
    throw error;
  }

  const store = upload.purpose === "APPLICATION_PHOTO" ? storage.putPrivate : storage.putPublic;
  // Writing the same key again on a retry gives the same file, so a half-finished earlier run does no harm.
  for (const copy of copies) await store(processedKey(upload, copy.width), copy.body, "image/webp");

  // Only now is the result final and stored; the original (with any GPS data) can go.
  const marked = await withTx((tx) => markUploadReady(tx, upload.id, size, now));
  await storage.deletePrivate(upload.storageKey);
  return marked ? { outcome: "ready", ...size } : { outcome: "skipped", why: "changed while processing" };
}
