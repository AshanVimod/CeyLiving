-- B08: PayHere payments, refunds and the chargeback payout hold (backend plan 9.2, PAY-01 to PAY-08, BR-09, BR-18).
-- Only adds things (DB-11, expand step), so the previous app version keeps working against this schema:
--   * payments: one row per PayHere payment, unique (provider, provider_payment_id), so a repeated notification
--     finds the row and changes nothing (PAY-04). raw keeps only allow-listed notification fields, never card data
--     (PAY-01). needs_refund_reason flags money that arrived for an order that expired or was already paid (PAY-06).
--   * refunds: admin refunds (BR-18), for one seller order or (seller_order_id NULL) for a whole unusable payment.
--     Partial unique indexes allow one live (PENDING or SUCCEEDED) refund per seller order and per whole payment.
--   * orders.paid_at, required for PAID / refunded orders. Existing PAID orders get placed_at (they were seeded paid).
--   * PaymentStatus gains REFUNDED and PARTIALLY_REFUNDED (build spec 7). Not used inside this migration.
--   * shops.payout_hold_reason / payout_held_at: a chargeback holds that shop's payouts until an admin releases it.
--   * payments and refunds lose DELETE for ceyliving_app: money records are never deleted.
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/before-b08-payments.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Rollback (run as ceyliving_migrator, after stopping the web app and the worker):
--   -- Money records are lost by this; export them first if any exist:
--   --   COPY payments TO STDOUT WITH CSV HEADER;  COPY refunds TO STDOUT WITH CSV HEADER;
--   -- Orders marked refunded must go back to PAID first (the previous version doesn't know these values):
--   UPDATE orders SET payment_status = 'PAID' WHERE payment_status IN ('REFUNDED', 'PARTIALLY_REFUNDED');
--   DROP TABLE "refunds";
--   DROP TABLE "payments";
--   DROP TYPE "RefundMethod"; DROP TYPE "RefundStatus"; DROP TYPE "ProviderPaymentStatus";
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_paid_has_paid_at";
--   ALTER TABLE "orders" DROP COLUMN "paid_at";
--   ALTER TABLE "shops" DROP COLUMN "payout_hold_reason", DROP COLUMN "payout_held_at";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261103120000_payments';
-- What can't be undone cleanly:
--   * PostgreSQL can't remove enum values, so REFUNDED and PARTIALLY_REFUNDED stay in PaymentStatus, unused after
--     the UPDATE above. Harmless; leave them.
--   * After the rollback, orders paid since this migration still say PAID but nothing records which PayHere payment
--     paid them, and a held shop's hold is gone. Keep the CSV exports for the accounts.
-- Restoring the backup instead (pg_restore --clean --if-exists -d ceyliving <file>) puts the whole database back
-- to the moment of the dump, which also loses every order, payment and account change made since. Use it only for
-- a failed migration, not to undo one that worked.

-- CreateEnum
CREATE TYPE "ProviderPaymentStatus" AS ENUM ('SUCCESS', 'PENDING', 'CANCELLED', 'FAILED', 'CHARGEDBACK');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('PAYHERE', 'MANUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "payout_held_at" TIMESTAMPTZ(3),
ADD COLUMN     "payout_hold_reason" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ProviderPaymentStatus" NOT NULL,
    "status_code" SMALLINT NOT NULL,
    "method" TEXT,
    "raw" JSONB NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "needs_refund_reason" TEXT,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "seller_order_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "clawback_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "provider_ref" TEXT,
    "failure" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "settled_at" TIMESTAMPTZ(3),
    "deducted_payout_id" TEXT,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_seller_order_id_idx" ON "refunds"("seller_order_id");

-- CreateIndex
CREATE INDEX "refunds_created_by_id_idx" ON "refunds"("created_by_id");

-- CreateIndex
CREATE INDEX "refunds_deducted_payout_id_idx" ON "refunds"("deducted_payout_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_deducted_payout_id_fkey" FOREIGN KEY ("deducted_payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- DB-07: payments come from PayHere only (for now), in LKR minor units; refunded never exceeds paid.
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_known" CHECK (provider IN ('PAYHERE'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK (amount_cents > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_code" CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_range" CHECK (refunded_cents BETWEEN 0 AND amount_cents);
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_code_known" CHECK (status_code IN (2, 0, -1, -2, -3));

-- DB-07: a refund is for a positive amount; the seller never gives back more than was refunded; a settled refund
-- has its reference, a failed one its reason.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK (amount_cents > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_clawback_range" CHECK (clawback_cents BETWEEN 0 AND amount_cents);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_succeeded_has_ref"
  CHECK (status <> 'SUCCEEDED' OR (provider_ref IS NOT NULL AND settled_at IS NOT NULL));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_length" CHECK (length(reason) BETWEEN 3 AND 500);

-- BR-18: one live refund per seller order, and one per whole payment (PAY-06). A FAILED one can be retried.
CREATE UNIQUE INDEX "refunds_one_live_per_seller_order" ON "refunds"("seller_order_id")
  WHERE seller_order_id IS NOT NULL AND status <> 'FAILED';
CREATE UNIQUE INDEX "refunds_one_live_per_whole_payment" ON "refunds"("payment_id")
  WHERE seller_order_id IS NULL AND status <> 'FAILED';

-- PAY-06: the admin's "needs refund" queue.
CREATE INDEX "payments_needs_refund_idx" ON "payments"("created_at") WHERE needs_refund_reason IS NOT NULL;

-- PAY-08: reconciliation reads the day's paid orders.
CREATE INDEX "orders_paid_at_idx" ON "orders"("paid_at") WHERE paid_at IS NOT NULL;

-- A paid (or later refunded) order always says when it was paid. Existing paid orders were seeded paid at placement.
UPDATE "orders" SET "paid_at" = "placed_at" WHERE "payment_status" = 'PAID' AND "paid_at" IS NULL;
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_has_paid_at"
  CHECK (payment_status IN ('PENDING', 'EXPIRED') OR paid_at IS NOT NULL) NOT VALID;
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_paid_has_paid_at";

-- A held shop says why and since when.
ALTER TABLE "shops" ADD CONSTRAINT "shops_payout_hold_complete"
  CHECK ((payout_hold_reason IS NULL) = (payout_held_at IS NULL));

-- Money records are never deleted by the app (the default privileges granted DELETE).
REVOKE DELETE, TRUNCATE ON "payments", "refunds" FROM ceyliving_app;
