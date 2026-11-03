import "server-only";
import type { Upload, UploadPurpose } from "@/lib/types";
import { toUpload } from "../db/mappers";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// B09: uploaded photos. The only code that touches upload rows (BE-01). Status moves are conditional updates
// (DB-06), so a repeated confirm or a second run of image.process changes nothing twice (JOB-03).

export async function insertUpload(
  tx: Tx,
  upload: Pick<Upload, "id" | "ownerId" | "storageKey" | "purpose" | "contentType" | "sizeBytes" | "createdAt">,
): Promise<Upload> {
  const row = await writableClientOf(tx).upload.create({
    data: { ...upload, status: "PENDING", createdAt: new Date(upload.createdAt) },
  });
  return toUpload(row);
}

export async function findUpload(tx: Tx, id: string): Promise<Upload | undefined> {
  const row = await clientOf(tx).upload.findUnique({ where: { id } });
  return row ? toUpload(row) : undefined;
}

/** SEC-A5: someone else's upload looks the same as a missing one. */
export async function findOwnUpload(tx: Tx, id: string, ownerId: string): Promise<Upload | undefined> {
  const row = await clientOf(tx).upload.findFirst({ where: { id, ownerId } });
  return row ? toUpload(row) : undefined;
}

/** The uploads among `ids` (at most a form's worth), in one query. */
export async function findUploadsByIds(tx: Tx, ids: string[]): Promise<Upload[]> {
  if (!ids.length) return [];
  const rows = await clientOf(tx).upload.findMany({ where: { id: { in: ids } } });
  return rows.map(toUpload);
}

/** Step 3 of 11.1: the browser says the file is there. True only for the first confirm. */
export async function markUploadConfirmed(tx: Tx, id: string, now: Date): Promise<boolean> {
  const { count } = await writableClientOf(tx).upload.updateMany({
    where: { id, status: "PENDING", confirmedAt: null },
    data: { confirmedAt: now },
  });
  return count === 1;
}

export async function markUploadReady(
  tx: Tx,
  id: string,
  size: { width: number; height: number },
  now: Date,
): Promise<boolean> {
  const { count } = await writableClientOf(tx).upload.updateMany({
    where: { id, status: "PENDING", confirmedAt: { not: null } },
    data: { status: "READY", width: size.width, height: size.height, processedAt: now },
  });
  return count === 1;
}

export async function markUploadRejected(tx: Tx, id: string, reason: string, now: Date): Promise<boolean> {
  const { count } = await writableClientOf(tx).upload.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", rejectReason: reason, processedAt: now },
  });
  return count === 1;
}

type Leftover = Pick<Upload, "id" | "storageKey" | "purpose" | "status">;
const leftoverFields = { id: true, storageKey: true, purpose: true, status: true } as const;

/** maintenance.cleanup: uploads still PENDING (never finished, or every processing try failed) since `before`. */
export async function unfinishedUploads(tx: Tx, before: Date, limit: number): Promise<Leftover[]> {
  return clientOf(tx).upload.findMany({
    where: { status: "PENDING", createdAt: { lt: before } },
    select: leftoverFields,
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * FR-17: uploads of deleted accounts that nothing public shows: application photos (private), and anything not
 * READY. READY product and shop photos stay while the shop's items still show them.
 */
export async function uploadsOfDeletedAccounts(tx: Tx, limit: number): Promise<Leftover[]> {
  return clientOf(tx).upload.findMany({
    where: {
      owner: { deletedAt: { not: null } },
      OR: [{ purpose: "APPLICATION_PHOTO" satisfies UploadPurpose }, { status: { not: "READY" } }],
    },
    select: leftoverFields,
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function deleteUploadRow(tx: Tx, id: string): Promise<void> {
  await writableClientOf(tx).upload.deleteMany({ where: { id } });
}
