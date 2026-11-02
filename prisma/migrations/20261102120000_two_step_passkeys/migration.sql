-- B05b: two-step sign-in and passkeys (backend plan AU-02 to AU-04).
-- Only adds things (DB-11, expand step): every existing user, role and row stays as it is, and the previous app
-- version keeps working against this schema. Both new columns are NOT NULL with a constant default, which
-- PostgreSQL adds without rewriting the table. Existing sessions get two_step = false, so sellers and admins who
-- are signed in now are asked to set up two-step before /seller or /admin opens again.
-- The app user (ceyliving_app) gets data rights on the new tables through the default privileges set in the first
-- migration (DB-10).
--
-- Rollback, if this ever has to be undone before anything depends on it (run as ceyliving_migrator):
--   DROP TABLE passkeys, two_factors;
--   ALTER TABLE sessions DROP COLUMN two_step;
--   ALTER TABLE users DROP COLUMN two_factor_enabled;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261102120000_two_step_passkeys';
-- That removes every authenticator app and passkey people have set up, so take a backup first (pg_dump).

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "two_step" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "two_factors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failed_verification_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "created_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "two_factors_user_id_key" ON "two_factors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
