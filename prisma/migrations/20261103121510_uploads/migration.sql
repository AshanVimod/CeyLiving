-- B09: uploads and image processing (backend plan 7.2 `uploads`, 11.1; build spec SEC-07).
-- Only adds things (DB-11, expand step), so the previous app version keeps working against this schema:
--   * uploads: one row per photo a user uploads. The id (upl_<uuid>) is also the photo id that product, shop and
--     application rows store, next to the Unsplash ids already there (those rows are not touched).
--   * seller_applications.work_photo_ids: photo ids instead of full links. Filled here from work_photo_urls by
--     taking the Unsplash id out of each link, so every existing application keeps its photos. work_photo_urls is
--     left as it is (the previous version still reads it) and is dropped in a later contract step.
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/before-b09-uploads.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Check after migrating (both counts must be 0):
--   SELECT count(*) FROM seller_applications
--    WHERE cardinality(work_photo_ids) <> cardinality(coalesce(work_photo_urls, '{}'));
--   SELECT count(*) FROM seller_applications, unnest(work_photo_ids) AS p(id) WHERE p.id !~ '^[A-Za-z0-9-]{6,80}$';
--
-- Rollback (run as ceyliving_migrator, after stopping the web app and the worker):
--   -- Applications sent since this migration have only work_photo_ids; the previous version would show them
--   -- without photos. Export them first:  COPY (SELECT id, work_photo_ids FROM seller_applications) TO STDOUT CSV;
--   DROP TABLE "uploads";
--   DROP TYPE "UploadStatus"; DROP TYPE "UploadPurpose";
--   ALTER TABLE "seller_applications" DROP COLUMN "work_photo_ids";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261103121510_uploads';
-- What can't be undone cleanly:
--   * Products and shops saved since this migration may hold upl_ photo ids. The previous version would build
--     Unsplash links from them (broken images). Put the seed photo back or re-save those items before rolling back:
--       SELECT product_id FROM product_images WHERE photo_id LIKE 'upl\_%';
--       SELECT id FROM shops WHERE logo_photo_id LIKE 'upl\_%' OR banner_photo_id LIKE 'upl\_%';
--   * The files in the R2 buckets stay; delete them with the bucket tools if wanted.
-- Restoring the backup instead (pg_restore --clean --if-exists -d ceyliving <file>) puts the whole database back
-- to the moment of the dump. Use it only for a failed migration, not to undo one that worked.

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('PRODUCT_IMAGE', 'SHOP_LOGO', 'SHOP_BANNER', 'APPLICATION_PHOTO');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- AlterTable: photo ids for applications. Prisma models lists as nullable, so "never NULL" is a CHECK.
ALTER TABLE "seller_applications" ADD COLUMN     "work_photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "seller_applications"
SET "work_photo_ids" = ARRAY(
    SELECT substring(u FROM '^https://images\.unsplash\.com/photo-([A-Za-z0-9-]{6,80})')
    FROM unnest("work_photo_urls") WITH ORDINALITY AS t(u, n)
    -- Every stored link passed the Unsplash check when it was saved; anything else is skipped, never NULL.
    WHERE u ~ '^https://images\.unsplash\.com/photo-[A-Za-z0-9-]{6,80}'
    ORDER BY n
)
WHERE "work_photo_urls" IS NOT NULL AND cardinality("work_photo_urls") > 0;

ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_work_photo_ids_not_null"
    CHECK ("work_photo_ids" IS NOT NULL);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id"),
    -- SEC-07: what the browser said it would send. The worker checks the real bytes.
    CONSTRAINT "uploads_content_type_check" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT "uploads_size_check" CHECK ("size_bytes" BETWEEN 1 AND 8388608),
    CONSTRAINT "uploads_ready_has_size" CHECK (
        "status" <> 'READY'
        OR ("width" > 0 AND "height" > 0 AND "processed_at" IS NOT NULL AND "confirmed_at" IS NOT NULL)
    ),
    CONSTRAINT "uploads_rejected_has_reason" CHECK ("status" <> 'REJECTED' OR "reject_reason" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "uploads_storage_key_key" ON "uploads"("storage_key");

-- CreateIndex: owner lookups (attach checks, account deletion).
CREATE INDEX "uploads_owner_id_created_at_idx" ON "uploads"("owner_id", "created_at");

-- CreateIndex: maintenance.cleanup finds unfinished uploads older than a day.
CREATE INDEX "uploads_pending_created_at_idx" ON "uploads"("created_at") WHERE (status = 'PENDING'::"UploadStatus");

-- AddForeignKey (users are soft-deleted, FR-17, so RESTRICT never blocks a normal account deletion)
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: none needed. The init migration's ALTER DEFAULT PRIVILEGES gives ceyliving_app SELECT, INSERT, UPDATE
-- and DELETE on new tables (DELETE is used by maintenance.cleanup).
