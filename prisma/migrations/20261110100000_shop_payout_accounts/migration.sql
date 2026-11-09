-- B11: encrypted payout details (backend plan 12.4, G-09). Only adds things (DB-11, expand step), so the previous app
-- version keeps working against this schema:
--   * shop_payout_accounts: one row per shop with the bank details needed for a transfer. The account number is only
--     ever stored encrypted (lib/server/crypto/field-encryption.ts); the CHECK below refuses anything else.
--
-- Existing rows: nothing to migrate. Until now only shops.payout_account_masked was kept ("Bank •••• 1234"), so no
-- full number exists anywhere to encrypt. A seller with only the masked value counts as having no details and adds
-- them again. shops.payout_account_masked stays (the app still writes it, nothing reads it) and is dropped by a later
-- contract migration.
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/before-b11-payout-accounts.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Rollback (run as ceyliving_migrator, after stopping the web app and the worker):
--   DROP TABLE "shop_payout_accounts";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261110100000_shop_payout_accounts';
-- What is lost: every full account number entered since B11, so sellers would have to enter them again. The previous
-- version reads shops.payout_account_masked, which is still written, and keeps working.

-- CreateTable
CREATE TABLE "shop_payout_accounts" (
    "shop_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number_enc" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shop_payout_accounts_pkey" PRIMARY KEY ("shop_id")
);

-- AddForeignKey
ALTER TABLE "shop_payout_accounts" ADD CONSTRAINT "shop_payout_accounts_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DB-07 / G-09: a plain account number can't be stored, even by buggy code or by hand.
ALTER TABLE "shop_payout_accounts" ADD CONSTRAINT "shop_payout_accounts_number_encrypted"
    CHECK ("account_number_enc" ~ '^v1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$');
ALTER TABLE "shop_payout_accounts" ADD CONSTRAINT "shop_payout_accounts_last4"
    CHECK ("account_last4" ~ '^[0-9]{4}$');
ALTER TABLE "shop_payout_accounts" ADD CONSTRAINT "shop_payout_accounts_text_lengths"
    CHECK (char_length("bank_name") BETWEEN 3 AND 60
       AND char_length("branch") BETWEEN 2 AND 60
       AND char_length("account_name") BETWEEN 3 AND 80);

-- Grants: none needed. The init migration's ALTER DEFAULT PRIVILEGES gives ceyliving_app SELECT, INSERT, UPDATE
-- and DELETE on new tables (DELETE is used when an account is deleted, FR-17).
