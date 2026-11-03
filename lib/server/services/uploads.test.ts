// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/lib/env";
import type { User, UploadPurpose } from "@/lib/types";
import { uploadRequestSchema } from "@/lib/validation/upload";
import { migratorClient, queuedJobs, readAll, user, withTestDatabase } from "@/test/db";
import { productInput, validShop } from "@/test/fixtures";
import { runJobNow } from "@/test/jobs";
import { readyPhoto } from "@/test/uploads";
import { NotFoundError, RateLimitError, ValidationError } from "../errors";
import { findUpload } from "../repositories/uploads";
import { db } from "../db/tx";
import { getStorage, StorageError, type Storage } from "../storage";
import { localPath, receiveLocalUpload } from "../storage/local";
import { processUpload } from "./image-processing";
import { cleanUpOldRows } from "./maintenance";
import { saveProduct } from "./products";
import { updateShop } from "./shops";
import {
  assertPhotosUsable,
  confirmUpload,
  PHOTO_UNAVAILABLE,
  readApplicationPhoto,
  requestUpload,
  uploadStatus,
} from "./uploads";

withTestDatabase();

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ceyliving-uploads-"));
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("LOCAL_UPLOADS_DIR", root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

/** A real photo with camera details and a GPS position in its EXIF, like one straight off a phone. */
async function phonePhoto(width = 1200, height = 900) {
  return sharp({ create: { width, height, channels: 3, background: "#a33a2a" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestPhone", Copyright: "Nimali Perera" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "7/1 17/1 30/1", GPSLongitudeRef: "E", GPSLongitude: "80/1 38/1 0/1" },
    })
    .toBuffer();
}

/** What the browser does: ask for an address, PUT the file there (the dev route), then confirm. */
async function upload(actor: User, purpose: UploadPurpose, bytes: Buffer, contentType = "image/jpeg") {
  const ticket = await requestUpload(actor, { purpose, contentType: contentType as never, sizeBytes: bytes.length });
  const status = await receiveLocalUpload(
    getEnv(),
    new Request(`http://localhost${ticket.url}`, {
      method: "PUT",
      headers: { ...ticket.headers, "content-length": String(bytes.length) },
      body: new Uint8Array(bytes),
    }),
  );
  expect(status).toBe(200);
  await confirmUpload(actor, ticket.uploadId);
  return ticket.uploadId;
}

const filesUnder = async (dir: string) =>
  (await readdir(path.join(root, dir), { recursive: true }).catch(() => [] as string[])).filter((f) =>
    f.endsWith(".webp"),
  );

const originalExists = async (uploadId: string) => {
  const { storageKey } = (await findUpload(db, uploadId))!;
  return readFile(localPath(getEnv(), "private", storageKey)).then(
    () => true,
    () => false,
  );
};

describe("B09 uploads", () => {
  it("SEC-07 refuses a declared type other than JPEG, PNG or WebP, and a declared size over 8 MB", () => {
    const ask = (contentType: string, sizeBytes: number) =>
      uploadRequestSchema.safeParse({ purpose: "PRODUCT_IMAGE", contentType, sizeBytes });
    expect(ask("image/jpeg", 8 * 1024 * 1024).success).toBe(true);
    expect(ask("image/svg+xml", 1000).error!.issues[0]!.message).toBe("Choose a JPEG, PNG or WebP photo.");
    expect(ask("application/pdf", 1000).success).toBe(false);
    expect(ask("image/png", 8 * 1024 * 1024 + 1).error!.issues[0]!.message).toBe("Choose a photo under 8 MB.");
  });

  it("SEC-07 rejects a non-image file that claims to be a JPEG", async () => {
    const id = await upload(user("user_seller"), "PRODUCT_IMAGE", Buffer.from("%PDF-1.7 definitely not a photo"));
    expect(await processUpload(id)).toEqual({
      outcome: "rejected",
      reason: "That file isn’t a JPEG, PNG or WebP photo.",
    });
    expect((await findUpload(db, id))!.status).toBe("REJECTED");
    expect(await originalExists(id)).toBe(false);
    expect(await filesUnder("public")).toEqual([]);
  });

  it("SEC-07 rejects a file larger than 8 MB even when it declared less", async () => {
    const seller = user("user_seller");
    // The upload address only takes the declared size: a bigger body is refused at the door.
    const ticket = await requestUpload(seller, { purpose: "PRODUCT_IMAGE", contentType: "image/jpeg", sizeBytes: 10 });
    const tooBig = new Request(`http://localhost${ticket.url}`, {
      method: "PUT",
      headers: { ...ticket.headers, "content-length": "10" },
      body: new Uint8Array(11),
    });
    expect(await receiveLocalUpload(getEnv(), tooBig)).toBe(413);

    // A 9 MB file that got there some other way is refused on confirm and its upload marked REJECTED.
    const second = await requestUpload(seller, {
      purpose: "PRODUCT_IMAGE",
      contentType: "image/jpeg",
      sizeBytes: 1000,
    });
    const { storageKey } = (await findUpload(db, second.uploadId))!;
    const file = localPath(getEnv(), "private", storageKey);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.alloc(9 * 1024 * 1024));
    await expect(confirmUpload(seller, second.uploadId)).rejects.toBeInstanceOf(ValidationError);
    expect((await findUpload(db, second.uploadId))!.status).toBe("REJECTED");
    expect(await originalExists(second.uploadId)).toBe(false);
  });

  it("SEC-07 the dev upload address takes only the signed type, size and key", async () => {
    const ticket = await requestUpload(user("user_seller"), {
      purpose: "PRODUCT_IMAGE",
      contentType: "image/png",
      sizeBytes: 3,
    });
    const put = (url: string, type: string) =>
      receiveLocalUpload(
        getEnv(),
        new Request(`http://localhost${url}`, {
          method: "PUT",
          headers: { "content-type": type, "content-length": "3" },
          body: new Uint8Array(3),
        }),
      );
    expect(await put(ticket.url, "image/jpeg")).toBe(403);
    expect(await put(ticket.url.replace(/sig=[^&]+/, "sig=forged"), "image/png")).toBe(403);
    expect(await put(ticket.url.replace(/key=[^&]+/, "key=u%2Fuser_admin%2Fx"), "image/png")).toBe(403);
    expect(await put(ticket.url, "image/png")).toBe(200);
  });

  it("SEC-07 processed images carry no EXIF or GPS", async () => {
    const original = await phonePhoto();
    const inputExif = (await sharp(original).metadata()).exif!;
    expect(inputExif.toString("latin1")).toContain("TestPhone");
    expect(inputExif.includes(Buffer.from([0x88, 0x25])) || inputExif.includes(Buffer.from([0x25, 0x88]))).toBe(true); // GPS IFD

    const id = await upload(user("user_seller"), "PRODUCT_IMAGE", original);
    expect(await processUpload(id)).toMatchObject({ outcome: "ready", width: 1200, height: 900 });
    const files = await filesUnder("public");
    expect(files).toHaveLength(3);
    for (const file of files) {
      const bytes = await readFile(path.join(root, "public", file));
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(bytes.includes("Exif")).toBe(false);
      expect(bytes.includes("TestPhone")).toBe(false);
    }
    // The original, which still has the GPS position, is gone once the copies are stored.
    expect(await originalExists(id)).toBe(false);
  });

  it("SEC-07 makes WebP copies at 400, 800 and 1600 without enlarging", async () => {
    const id = await upload(user("user_seller"), "PRODUCT_IMAGE", await phonePhoto(1000, 750));
    await processUpload(id);
    const widths: Record<string, number> = {};
    for (const size of ["400", "800", "1600"]) {
      const bytes = await readFile(localPath(getEnv(), "public", `i/${id}/${size}.webp`));
      widths[size] = (await sharp(bytes).metadata()).width!;
    }
    expect(widths).toEqual({ "400": 400, "800": 800, "1600": 1000 });
    expect(await findUpload(db, id)).toMatchObject({ status: "READY", width: 1000, height: 750 });
  });

  it("SEC-07 refuses a photo too small to use", async () => {
    const id = await upload(user("user_seller"), "PRODUCT_IMAGE", await phonePhoto(200, 150));
    expect(await processUpload(id)).toMatchObject({ outcome: "rejected" });
  });

  it("SEC-07 application photos are never written to the public bucket", async () => {
    const id = await upload(user("user_customer"), "APPLICATION_PHOTO", await phonePhoto());
    expect(await processUpload(id)).toMatchObject({ outcome: "ready" });
    expect(await filesUnder("public")).toEqual([]);
    expect(await filesUnder("private")).toHaveLength(3);
  });

  it("SEC-A5 only the applicant and admins can open an application photo", async () => {
    const id = await upload(user("user_customer"), "APPLICATION_PHOTO", await phonePhoto());
    await processUpload(id);
    const mine = await readApplicationPhoto(user("user_customer"), id, 800);
    expect((await sharp(mine).metadata()).width).toBe(800);
    expect(await readApplicationPhoto(user("user_admin"), id, 400)).toBeInstanceOf(Buffer);
    await expect(readApplicationPhoto(user("user_seller"), id, 800)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readApplicationPhoto({ ...user("user_admin"), needsTwoStep: true } as User, id, 800)).rejects.toThrow(
      /two-step/,
    );
    // Product photos are public files; this route never serves them.
    const product = await upload(user("user_seller"), "PRODUCT_IMAGE", await phonePhoto());
    await processUpload(product);
    await expect(readApplicationPhoto(user("user_seller"), product, 800)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("SEC-A5 confirming or reading someone else's upload looks missing", async () => {
    const ticket = await requestUpload(user("user_seller"), {
      purpose: "PRODUCT_IMAGE",
      contentType: "image/jpeg",
      sizeBytes: 100,
    });
    await expect(confirmUpload(user("user_customer"), ticket.uploadId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(uploadStatus(user("user_customer"), ticket.uploadId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await uploadStatus(user("user_seller"), ticket.uploadId)).status).toBe("PENDING");
  });

  it("SEC-A1 only sellers upload shop and item photos; only customers upload application photos", async () => {
    const ask = (purpose: UploadPurpose) => ({ purpose, contentType: "image/jpeg" as const, sizeBytes: 100 });
    await expect(requestUpload(user("user_customer"), ask("PRODUCT_IMAGE"))).rejects.toThrow();
    await expect(requestUpload(user("user_seller"), ask("APPLICATION_PHOTO"))).rejects.toThrow();
    await expect(
      requestUpload({ ...user("user_seller"), needsTwoStep: true } as User, ask("SHOP_LOGO")),
    ).rejects.toThrow(/two-step/);
  });

  it("SEC-A6 the 31st upload request in an hour is refused", async () => {
    const seller = user("user_seller");
    const ask = { purpose: "PRODUCT_IMAGE" as const, contentType: "image/jpeg" as const, sizeBytes: 100 };
    for (let i = 0; i < 30; i++) await requestUpload(seller, ask);
    await expect(requestUpload(seller, ask)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("JOB-02 confirming twice queues image.process once", async () => {
    const seller = user("user_seller");
    const id = await upload(seller, "PRODUCT_IMAGE", await phonePhoto());
    await confirmUpload(seller, id);
    const jobs = (await queuedJobs("image.process")).filter((j) => (j.data as { uploadId: string }).uploadId === id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.singletonKey).toBe(id);
  });

  it("JOB-03 image.process run twice gives the same result", async () => {
    const id = await upload(user("user_seller"), "PRODUCT_IMAGE", await phonePhoto());
    await runJobNow("image.process", { uploadId: id });
    const first = await findUpload(db, id);
    const lines = await runJobNow("image.process", { uploadId: id });
    expect(await findUpload(db, id)).toEqual(first);
    expect(lines.find((l) => l.msg === "job.completed")).toMatchObject({ outcome: "skipped", why: "ready" });
    expect(await filesUnder("public")).toHaveLength(3);
  });

  it("JOB-04 a storage error keeps the original and retries", async () => {
    const id = await upload(user("user_seller"), "PRODUCT_IMAGE", await phonePhoto());
    const real = getStorage();
    const failing: Storage = {
      ...real,
      putPublic: async () => {
        throw new StorageError("R2 put public answered 503", 503);
      },
    };
    await expect(processUpload(id, new Date(), failing)).rejects.toBeInstanceOf(StorageError);
    expect((await findUpload(db, id))!.status).toBe("PENDING");
    expect(await originalExists(id)).toBe(true);
    // The retry with storage working again finishes it.
    expect(await processUpload(id)).toMatchObject({ outcome: "ready" });
    expect(await originalExists(id)).toBe(false);
  });

  it("JOB-06 maintenance.cleanup removes uploads still unfinished after a day, files and rows", async () => {
    const seller = user("user_seller");
    const stale = await requestUpload(seller, { purpose: "PRODUCT_IMAGE", contentType: "image/jpeg", sizeBytes: 5 });
    const { storageKey } = (await findUpload(db, stale.uploadId))!;
    const file = localPath(getEnv(), "private", storageKey);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "hello");
    const fresh = await requestUpload(seller, { purpose: "PRODUCT_IMAGE", contentType: "image/jpeg", sizeBytes: 5 });
    await migratorClient().upload.update({
      where: { id: stale.uploadId },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });

    const result = await cleanUpOldRows();
    expect(result.unfinishedUploads).toBe(1);
    expect(await findUpload(db, stale.uploadId)).toBeUndefined();
    expect(await originalExists(fresh.uploadId)).toBe(false); // never sent; nothing to remove
    expect(await findUpload(db, fresh.uploadId)).toBeDefined();
    expect(await readFile(file).catch(() => null)).toBeNull();
  });
});

describe("B09 attaching photos", () => {
  it("SEC-A2 a seller cannot attach another user's upload", async () => {
    const seller = user("user_seller");
    const someoneElses = await readyPhoto("user_owner_galle-beeralu-studio", "PRODUCT_IMAGE");
    const refused = saveProduct(seller, productInput({ images: [{ id: someoneElses, alt: "A mask" }] }), "submit");
    await expect(refused).rejects.toMatchObject({ fieldErrors: { "images.0.id": PHOTO_UNAVAILABLE } });

    const theirLogo = await readyPhoto("user_owner_galle-beeralu-studio", "SHOP_LOGO");
    const mine = await readyPhoto("user_seller", "SHOP_BANNER");
    await expect(
      updateShop(
        seller,
        validShop({
          slug: "ambalangoda-mask-house",
          logo: { id: theirLogo, alt: "Logo" },
          banner: { id: mine, alt: "Banner" },
        }),
      ),
    ).rejects.toMatchObject({ fieldErrors: { "logo.id": PHOTO_UNAVAILABLE } });
  });

  it("SEC-A2 refuses an unfinished upload, one made for another kind of photo, and a new Unsplash link", async () => {
    const seller = user("user_seller");
    const uses = async (id: string) =>
      assertPhotosUsable(db, seller, [{ field: "images.0.id", id, purpose: "PRODUCT_IMAGE" }]);
    await expect(uses(await readyPhoto("user_seller", "PRODUCT_IMAGE", "PENDING"))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(uses(await readyPhoto("user_seller", "SHOP_LOGO"))).rejects.toBeInstanceOf(ValidationError);
    await expect(uses("1786468539104-e03f3ae580ea")).rejects.toBeInstanceOf(ValidationError);
    await expect(uses(`upl_${crypto.randomUUID()}`)).rejects.toBeInstanceOf(ValidationError);
    await expect(uses(await readyPhoto("user_seller", "PRODUCT_IMAGE"))).resolves.toBeUndefined();
  });

  it("SEC-A2 an item keeps the photos it already has (seed photos included) when edited", async () => {
    const seller = user("user_seller");
    const item = (await readAll()).products.find((p) => p.shopSlug === "ambalangoda-mask-house")!;
    const edited = await saveProduct(
      seller,
      productInput({ title: item.title, images: item.images.map((i) => ({ id: i.id, alt: i.alt })) }),
      "draft",
      item.id,
    );
    expect(edited.images.map((i) => i.id)).toEqual(item.images.map((i) => i.id));
  });

  it("SEC-A2 the seller's own finished upload becomes the item's photo", async () => {
    const seller = user("user_seller");
    const id = await upload(seller, "PRODUCT_IMAGE", await phonePhoto());
    await processUpload(id);
    const item = await saveProduct(seller, productInput({ images: [{ id, alt: "Kolam mask" }] }), "submit");
    expect(item.images[0]!.id).toBe(id);
  });
});

describe("B09 migration", () => {
  it("B09 keeps every existing application's photos (work_photo_urls → work_photo_ids)", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "prisma/migrations/20261103121510_uploads/migration.sql"),
      "utf8",
    );
    const backfill = /UPDATE "seller_applications"[\s\S]*?;\n/.exec(sql)![0];
    const client = migratorClient();
    await client.$executeRawUnsafe(`UPDATE seller_applications SET work_photo_ids = '{}', work_photo_urls = ARRAY[
      'https://images.unsplash.com/photo-1786468539104-e03f3ae580ea',
      'https://images.unsplash.com/photo-1759523121247-76be6b3490b2?w=800',
      'https://images.unsplash.com/photo-1788296817269-8df0458ab799']`);
    await client.$executeRawUnsafe(backfill);
    const rows = await client.$queryRawUnsafe<{ ids: string[] }[]>(
      "SELECT work_photo_ids AS ids FROM seller_applications",
    );
    expect(rows.map((r) => r.ids)).toEqual([
      ["1786468539104-e03f3ae580ea", "1759523121247-76be6b3490b2", "1788296817269-8df0458ab799"],
    ]);
  });
});
