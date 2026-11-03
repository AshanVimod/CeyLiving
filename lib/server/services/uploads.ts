import "server-only";
import { UPLOAD_LIMITS } from "@/lib/config";
import { isUploadId } from "@/lib/photos";
import type { Upload, UploadPurpose } from "@/lib/types";
import type { UploadRequest } from "@/lib/validation/upload";
import { db, withTx, type Tx } from "../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { logger } from "../observability/logger";
import { assertEmailVerified, assertTwoStep, shopOfSeller, type Actor } from "../permissions";
import { enqueue } from "../repositories/jobs";
import { newId } from "../repositories/people";
import {
  findOwnUpload,
  findUpload,
  findUploadsByIds,
  insertUpload,
  markUploadConfirmed,
  markUploadRejected,
} from "../repositories/uploads";
import { getStorage, processedKey, type PresignedPut, type Storage } from "../storage";
import { assertRateLimit } from "./shared";

// B09 (backend plan 11.1, SEC-07): photo uploads. The browser asks for an address (requestUpload), sends the file
// straight to storage, then confirms (confirmUpload), which queues image.process in the same transaction (JOB-02).
// Forms then send the upload's id; assertPhotosUsable decides whether this person may attach it (SEC-A2).

const log = logger.child({ component: "uploads" });

/** Who may upload what: sellers with an open shop for their shop and items; customers for an application. */
async function assertMayUpload(actor: Actor, purpose: UploadPurpose, tx: Tx): Promise<void> {
  if (purpose === "APPLICATION_PHOTO") {
    if (actor.role !== "CUSTOMER") throw new ForbiddenError("Only customer accounts can apply to open a shop.");
    assertEmailVerified(actor); // AU-01
    return;
  }
  const shop = await shopOfSeller(actor, tx); // RULE-S1, AU-02
  if (shop.status === "CLOSED") throw new ConflictError("This shop is closed.");
}

/** Step 1-2: a PENDING upload and a 5-minute address bound to the declared type and size. */
export async function requestUpload(
  actor: Actor,
  input: UploadRequest,
  now = new Date(),
  storage: Storage = getStorage(),
): Promise<{ uploadId: string } & PresignedPut> {
  const upload = await withTx(async (tx) => {
    await assertMayUpload(actor, input.purpose, tx);
    await assertRateLimit(tx, actor.id, "upload", now); // 30 an hour (11.1)
    const uploadId = newId("upl");
    return insertUpload(tx, {
      id: uploadId,
      ownerId: actor.id,
      // The key names no file the person chose: nothing from the browser reaches a storage path.
      storageKey: `u/${actor.id}/${crypto.randomUUID()}`,
      purpose: input.purpose,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      createdAt: now.toISOString(),
    });
  });
  const presigned = await storage.presignPut(upload.storageKey, input);
  log.info({ uploadId: upload.id, purpose: upload.purpose, sizeBytes: upload.sizeBytes }, "upload.requested");
  return { uploadId: upload.id, ...presigned };
}

const NOT_ARRIVED = "The photo didn’t arrive. Choose it again.";

/**
 * Step 3: the browser says the file is there. Checks it really is and isn't bigger than declared, then queues
 * image.process. Confirming again changes nothing (JOB-03); someone else's upload looks missing (SEC-A5).
 */
export async function confirmUpload(
  actor: Actor,
  uploadId: string,
  now = new Date(),
  storage: Storage = getStorage(),
): Promise<Upload> {
  const upload = await findOwnUpload(db, uploadId, actor.id);
  if (!upload) throw new NotFoundError("We couldn’t find that photo.");
  if (upload.status !== "PENDING" || upload.confirmedAt) return upload;

  const stored = await storage.headPrivate(upload.storageKey);
  if (!stored) throw new ValidationError(NOT_ARRIVED);
  if (stored.sizeBytes > UPLOAD_LIMITS.maxBytes || stored.sizeBytes !== upload.sizeBytes) {
    // SEC-07: R2 checks the signed length; this catches any other way a different file got there.
    await withTx((tx) => markUploadRejected(tx, upload.id, "The file was not the size it said it was.", now));
    await storage.deletePrivate(upload.storageKey);
    log.warn({ uploadId, declared: upload.sizeBytes, stored: stored.sizeBytes }, "upload.size_mismatch");
    throw new ValidationError("That photo is larger than 8 MB or changed while uploading. Choose it again.");
  }

  await withTx(async (tx) => {
    if (await markUploadConfirmed(tx, upload.id, now)) {
      await enqueue(tx, "image.process", { uploadId: upload.id }, { singletonKey: upload.id });
    }
  });
  log.info({ uploadId }, "upload.confirmed");
  return (await findOwnUpload(db, uploadId, actor.id))!;
}

/** Step 4 (the form waits for it): the person's own upload's status. */
export async function uploadStatus(actor: Actor, uploadId: string): Promise<Upload> {
  const upload = await findOwnUpload(db, uploadId, actor.id);
  if (!upload) throw new NotFoundError("We couldn’t find that photo.");
  return upload;
}

export interface PhotoUse {
  /** The form field, for the error message (e.g. "images.2.id", "logo.id"). */
  field: string;
  id: string;
  purpose: UploadPurpose;
}

/** One message for missing, someone else's, unfinished or wrong-kind, so it reveals nothing (SEC-A5). */
export const PHOTO_UNAVAILABLE = "This photo isn’t available. Upload it again.";

/**
 * SEC-A2 (11.1 step 5): a photo already saved on this item, shop or application stays. Any other photo must be an
 * upload this person made for this kind of photo, and image.process must have finished it (READY).
 */
export async function assertPhotosUsable(
  tx: Tx,
  actor: Actor,
  uses: PhotoUse[],
  alreadyOn: Iterable<string> = [],
): Promise<void> {
  const kept = new Set(alreadyOn);
  const fresh = uses.filter((u) => !kept.has(u.id));
  const found = new Map(
    (
      await findUploadsByIds(
        tx,
        fresh.filter((u) => isUploadId(u.id)).map((u) => u.id),
      )
    ).map((u) => [u.id, u]),
  );
  const fieldErrors: Record<string, string> = {};
  for (const use of fresh) {
    const upload = found.get(use.id);
    const usable = upload && upload.ownerId === actor.id && upload.status === "READY" && upload.purpose === use.purpose;
    if (!usable) fieldErrors[use.field] = PHOTO_UNAVAILABLE;
  }
  if (Object.keys(fieldErrors).length) {
    log.warn({ actorId: actor.id, fields: Object.keys(fieldErrors) }, "upload.attach_refused");
    throw new ValidationError("Some photos aren’t available. Upload them again.", fieldErrors);
  }
}

/**
 * B09 (design change after review): application photos are private. The applicant and admins can see them;
 * for anyone else, and for any other kind of upload, it is NotFound (SEC-A5).
 */
export async function readApplicationPhoto(
  actor: Actor,
  uploadId: string,
  width: number,
  storage: Storage = getStorage(),
): Promise<Buffer> {
  if (!isUploadId(uploadId)) throw new NotFoundError();
  const upload = await findUpload(db, uploadId);
  if (!upload || upload.purpose !== "APPLICATION_PHOTO" || upload.status !== "READY") throw new NotFoundError();
  if (upload.ownerId !== actor.id) {
    if (actor.role !== "ADMIN") throw new NotFoundError();
    assertTwoStep(actor); // AU-02: admin work needs a two-step session
  }
  const fetched = await storage.getPrivate(processedKey(upload, width), UPLOAD_LIMITS.maxBytes);
  if (fetched.kind !== "ok") throw new NotFoundError();
  return fetched.bytes;
}
