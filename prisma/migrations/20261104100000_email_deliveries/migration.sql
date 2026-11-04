-- B10: email (backend plan 11.2, 10.2 email.send). Only adds things (DB-11, expand step), so the previous app
-- version keeps working against this schema:
--   * email_deliveries: one row per email the app sends. Services add it in the business transaction together with
--     the email.send job (JOB-02); its unique dedupe_key makes a repeated event send once (JOB-03).
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/before-b10-email.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Rollback (run as ceyliving_migrator, after stopping the web app and the worker):
--   DROP TABLE "email_deliveries";
--   DROP TYPE "EmailStatus";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261104100000_email_deliveries';
-- What is lost: the delivery history only. email.send jobs still queued then fail their payload check (the previous
-- version expects another payload) and alert the admins; nothing else depends on this table.

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "to_address" TEXT,
    "data" JSONB,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "alerted_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_deliveries_sent_has_id" CHECK (
        "status" <> 'SENT' OR ("provider_message_id" IS NOT NULL AND "sent_at" IS NOT NULL)
    ),
    -- Data minimisation: once an email is final, its address and data (which may hold a sign-in link) are gone.
    CONSTRAINT "email_deliveries_final_is_minimal" CHECK (
        "status" = 'QUEUED' OR ("data" IS NULL AND "to_address" IS NULL)
    ),
    CONSTRAINT "email_deliveries_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "email_deliveries_last_error_length" CHECK (char_length("last_error") <= 200)
);

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_dedupe_key_key" ON "email_deliveries"("dedupe_key");

-- CreateIndex: a person's emails (account deletion, support questions).
CREATE INDEX "email_deliveries_user_id_created_at_idx" ON "email_deliveries"("user_id", "created_at");

-- CreateIndex: email.watch, /admin/emails and the worker health check find emails still waiting.
CREATE INDEX "email_deliveries_queued_created_at_idx" ON "email_deliveries"("created_at") WHERE (status = 'QUEUED'::"EmailStatus");

-- AddForeignKey (users are soft-deleted, FR-17, so RESTRICT never blocks a normal account deletion)
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: none needed. The init migration's ALTER DEFAULT PRIVILEGES gives ceyliving_app SELECT, INSERT, UPDATE
-- and DELETE on new tables (DELETE is used by maintenance.cleanup).
