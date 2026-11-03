import "server-only";
import type { Env } from "@/lib/env";
import type { Upload } from "@/lib/types";

// B09 (backend plan 11.1, SEC-07): where uploaded files live. Two places:
//   * private: originals (u/<userId>/<uuid>, can carry EXIF/GPS) and processed application photos (p/<uploadId>/…).
//     Never served directly; the app reads them for the worker and for the applicant/admin route.
//   * public: processed product and shop photos (i/<uploadId>/<width>.webp), served at NEXT_PUBLIC_IMAGE_BASE_URL.
// Keys are always made by the server and checked against these shapes, so a key can't point anywhere else.

export const ORIGINAL_KEY = /^u\/[A-Za-z0-9_-]{1,100}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A processed product or shop photo in the public bucket. */
export const PUBLIC_KEY = /^i\/upl_[0-9a-f-]{36}\/(400|800|1600)\.webp$/;
/** A processed application photo, kept private. */
export const PRIVATE_PHOTO_KEY = /^p\/upl_[0-9a-f-]{36}\/(400|800|1600)\.webp$/;

/** Where a processed size goes: application photos stay private (applicant and admins only). */
export function processedKey(upload: Pick<Upload, "id" | "purpose">, width: number): string {
  return `${upload.purpose === "APPLICATION_PHOTO" ? "p" : "i"}/${upload.id}/${width}.webp`;
}

/** One of the private shapes (an original or a private photo). */
export const isPrivateKey = (key: string) => ORIGINAL_KEY.test(key) || PRIVATE_PHOTO_KEY.test(key);

/** SEC-07: a presigned upload address lasts 5 minutes. */
export const PRESIGN_SECONDS = 300;

export interface PresignedPut {
  url: string;
  /** Headers the browser must send with the PUT (the signature covers them). */
  headers: Record<string, string>;
}

export type Fetched = { kind: "ok"; bytes: Buffer } | { kind: "missing" } | { kind: "too-large" };

export interface Storage {
  readonly driver: Env["STORAGE_DRIVER"];
  /** An address the browser can PUT exactly this type and size to, for PRESIGN_SECONDS. */
  presignPut(key: string, file: { contentType: string; sizeBytes: number }): Promise<PresignedPut>;
  /** The private file's size, or null when nothing was uploaded there. */
  headPrivate(key: string): Promise<{ sizeBytes: number } | null>;
  /** Reads a private file, giving up past `maxBytes` (never holds more than that in memory). */
  getPrivate(key: string, maxBytes: number): Promise<Fetched>;
  putPrivate(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Deleting a missing file is not an error (JOB-03). */
  deletePrivate(key: string): Promise<void>;
  putPublic(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deletePublic(key: string): Promise<void>;
}

/** Thrown for a storage call that failed (network, credentials, provider error). Jobs retry it (JOB-04). */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Reads a body into memory, giving up once it passes `maxBytes` (a sender can't make us hold more than that).
 * Undefined when it was too large.
 */
export async function readAtMost(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
}

export function assertKey(key: string, shape: RegExp | ((key: string) => boolean)): void {
  if (!(typeof shape === "function" ? shape(key) : shape.test(key)))
    throw new StorageError("Refused a storage key of an unexpected shape.");
}
