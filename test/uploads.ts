import { randomUUID } from "node:crypto";
import type { UploadPurpose } from "@/lib/types";
import { migratorClient } from "./db";

// B09: finished uploads for tests that save photos. Services only accept a new photo that is the actor's own
// READY upload of the right kind (SEC-A2), so tests make those here instead of posting Unsplash links.

export async function readyPhoto(ownerId: string, purpose: UploadPurpose, status: "READY" | "PENDING" = "READY") {
  const id = `upl_${randomUUID()}`;
  const now = new Date();
  await migratorClient().upload.create({
    data: {
      id,
      ownerId,
      storageKey: `u/${ownerId}/${randomUUID()}`,
      purpose,
      contentType: "image/jpeg",
      sizeBytes: 120_000,
      status,
      createdAt: now,
      ...(status === "READY" && { width: 1600, height: 1200, confirmedAt: now, processedAt: now }),
    },
  });
  return id;
}

/** Overrides for validShop: a logo and banner this seller uploaded. */
export async function shopPhotos(ownerId: string) {
  return {
    logo: { id: await readyPhoto(ownerId, "SHOP_LOGO"), alt: "Lacquered bowl" },
    banner: { id: await readyPhoto(ownerId, "SHOP_BANNER"), alt: "Workshop shelves" },
  };
}

/** Overrides for productInput: one photo this seller uploaded. */
export async function productPhotos(ownerId: string) {
  return { images: [{ id: await readyPhoto(ownerId, "PRODUCT_IMAGE"), alt: "Red and yellow lacquered box" }] };
}

/** Overrides for validApplication: three photos this applicant uploaded. */
export async function applicationPhotos(ownerId: string) {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(await readyPhoto(ownerId, "APPLICATION_PHOTO"));
  return { workPhotoIds: ids };
}
