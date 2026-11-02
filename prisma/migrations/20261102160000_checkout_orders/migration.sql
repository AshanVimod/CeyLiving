-- B07: checkout creates orders and reserves stock (backend plan 9.1, BR-04 to BR-06, G-03, G-08).
-- Only adds things (DB-11, expand step), so the previous app version keeps working against this schema:
--   * PaymentStatus (PENDING, PAID, EXPIRED) and orders.payment_status. The column is added with DEFAULT 'PAID', so
--     every existing order (all of them were placed before checkout existed, and count as paid) gets PAID, and then
--     the default is dropped: new code must say which status an order has, so an order can never become "paid" by a
--     forgotten field. A constant default doesn't rewrite the table (PostgreSQL 11+). The previous app version
--     doesn't write orders, so the missing default doesn't affect it.
--   * orders.idempotency_key, unique per customer: the same checkout submitted twice makes one order. NULL (the
--     existing orders) never clashes.
--   * orders.expires_at, and a CHECK that a PENDING order always has one (orders.expireUnpaid needs it).
--   * SellerOrderStatus gains PENDING_PAYMENT: a seller order waiting for payment, which sellers never see.
--   * order_items.customization (what the customer asked for, BR-16) and order_items.stock_reserved (whether checkout
--     took the quantity from stock, so an expiry gives back exactly that, BR-06). Nullable, and a constant default.
--   * order_number_seq for new order numbers (CM-<year>-<n>), starting above the seed's numbers. ceyliving_app gets
--     USAGE on it from the default privileges set in the init migration.
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/<name>.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Rollback (run as ceyliving_migrator, after stopping the web app and the worker so no checkout runs meanwhile):
--   -- Orders still waiting for payment must be finished first: let orders.expireUnpaid cancel them (at most 30
--   -- minutes), or check: SELECT count(*) FROM orders WHERE payment_status = 'PENDING';  (must be 0)
--   ALTER TABLE "orders" DROP CONSTRAINT "orders_pending_has_expiry", DROP CONSTRAINT "orders_idempotency_key_length";
--   DROP INDEX "orders_customer_id_idempotency_key_key";
--   ALTER TABLE "orders" DROP COLUMN "expires_at", DROP COLUMN "idempotency_key", DROP COLUMN "payment_status";
--   DROP TYPE "PaymentStatus";
--   ALTER TABLE "order_items" DROP COLUMN "customization", DROP COLUMN "stock_reserved";
--   DROP SEQUENCE "order_number_seq";
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261102160000_checkout_orders';
-- What can't be undone cleanly:
--   * PostgreSQL can't remove an enum value, so PENDING_PAYMENT stays in SellerOrderStatus. No row uses it once the
--     pending orders are finished (SELECT count(*) FROM seller_orders WHERE status = 'PENDING_PAYMENT' must be 0),
--     and the previous app version never writes it, so it is harmless. Leave it there.
--   * Dropping the columns loses which orders expired unpaid (their seller orders stay CANCELLED, with the reason)
--     and the customers' customization text on orders placed since. Export them first if they matter:
--     SELECT id, customization FROM order_items WHERE customization IS NOT NULL;
-- Restoring the backup instead (pg_restore --clean --if-exists -d ceyliving <file>) puts the whole database back
-- to the moment of the dump, which also loses every order and account change made since. Use it only for a failed
-- migration, not to undo one that worked.

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED');

-- AlterEnum
ALTER TYPE "SellerOrderStatus" ADD VALUE 'PENDING_PAYMENT' BEFORE 'NEW';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "customization" JSONB,
ADD COLUMN     "stock_reserved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: existing orders are paid; new ones must say (see the header).
ALTER TABLE "orders" ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PAID';
ALTER TABLE "orders" ALTER COLUMN "payment_status" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_customer_id_idempotency_key_key" ON "orders"("customer_id", "idempotency_key");

-- DB-07: an order waiting for payment always has an expiry time.
ALTER TABLE "orders" ADD CONSTRAINT "orders_pending_has_expiry"
  CHECK (payment_status <> 'PENDING' OR expires_at IS NOT NULL);

-- DB-07: an idempotency key is a UUID from the checkout page; keep stray long values out.
ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_key_length"
  CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 64);

-- New order numbers (CM-<year>-<n>); the seed uses 101 and up.
CREATE SEQUENCE "order_number_seq" START 1001;
