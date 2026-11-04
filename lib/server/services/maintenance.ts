import "server-only";
import { db, withTx } from "../db/tx";
import {
  deleteExpiredSessions,
  deleteExpiredVerifications,
  deleteOldAuthAttempts,
  deleteOldRateEvents,
} from "../repositories/people";
import { deleteOldEmailDeliveries } from "../repositories/email";
import { deleteUploadRow, unfinishedUploads, uploadsOfDeletedAccounts } from "../repositories/uploads";
import { getStorage, processedKey, type Storage } from "../storage";
import { PHOTO_WIDTHS } from "@/lib/photos";
import type { Upload } from "@/lib/types";
import { inBatches } from "./shared";

const DAY = 86_400_000;
/** B10: how long a finished email's record (template, key, provider id) is kept. */
export const EMAIL_RECORD_DAYS = 180;

/**
 * maintenance.cleanup (backend plan 10.2): deletes rows nothing reads any more. Rate events and sign-in attempt
 * counters older than a day (every SEC-A6 and AU-06 window is a day or shorter), expired sessions and expired email
 * links. B09: uploads never finished within a day, and deleted accounts' application photos and unfinished uploads
 * (FR-17), files first, then the row. B10: sent, failed and skipped email records after 180 days (they hold only the
 * template, key and provider id). Deleting what is already gone deletes nothing (JOB-03).
 */
export async function cleanUpOldRows(now = new Date(), storage: Storage = getStorage()) {
  const dayAgo = new Date(now.getTime() - DAY);
  const emailCutoff = new Date(now.getTime() - EMAIL_RECORD_DAYS * DAY);
  return {
    rateEvents: await inBatches((limit) => withTx((tx) => deleteOldRateEvents(tx, dayAgo, limit))),
    authAttempts: await inBatches((limit) => withTx((tx) => deleteOldAuthAttempts(tx, dayAgo.getTime(), limit))),
    sessions: await inBatches((limit) => withTx((tx) => deleteExpiredSessions(tx, now, limit))),
    verifications: await inBatches((limit) => withTx((tx) => deleteExpiredVerifications(tx, now, limit))),
    emailDeliveries: await inBatches((limit) => withTx((tx) => deleteOldEmailDeliveries(tx, emailCutoff, limit))),
    unfinishedUploads: await inBatches(async (limit) =>
      removeUploads(await unfinishedUploads(db, dayAgo, limit), storage),
    ),
    deletedAccountUploads: await inBatches(async (limit) =>
      removeUploads(await uploadsOfDeletedAccounts(db, limit), storage),
    ),
  };
}

/** Removes each upload's files (the original and any copies a half-finished run made), then its row. */
async function removeUploads(uploads: Pick<Upload, "id" | "storageKey" | "purpose">[], storage: Storage) {
  for (const upload of uploads) {
    await storage.deletePrivate(upload.storageKey);
    for (const width of PHOTO_WIDTHS) {
      const key = processedKey(upload, width);
      await (upload.purpose === "APPLICATION_PHOTO" ? storage.deletePrivate(key) : storage.deletePublic(key));
    }
    await withTx((tx) => deleteUploadRow(tx, upload.id));
  }
  return uploads.length;
}
