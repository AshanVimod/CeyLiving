-- B06: background worker and scheduled jobs (backend plan section 10, JOB-01 to JOB-07).
-- Only adds things (DB-11, expand step), so the previous app version keeps working against this schema:
--   * seller_orders.accept_deadline_at (BR-08) is a new nullable column. NULL means "no deadline", so every
--     existing order keeps its current behaviour and the auto-cancel job ignores it. B08 sets it when an order is
--     paid. Adding a nullable column without a default doesn't rewrite the table.
--   * Indexes for the scheduled jobs' lookups (DB-08): auto-cancel (status, accept_deadline_at), auto-complete
--     (status, dispatched_at), request expiry (status, updated_at) and a partial index for expired mutes. These tables are
--     small today, so a plain CREATE INDEX (a short write lock) is fine. On a large table they would need
--     CREATE INDEX CONCURRENTLY in their own migration.
--   * audit_log.actor_id becomes nullable: a NULL actor means the worker made the change, and the reason names the
--     job. The foreign key to users stays, and the app user still has INSERT and SELECT only on audit_log (DB-09).
--     DROP NOT NULL only changes the catalogue: no rewrite, no scan.
-- The job queue's own tables live in the "pgboss" schema. pg-boss installs and upgrades them itself
-- (`npm run jobs:migrate`, worker/migrate.ts), so they aren't part of this file.
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/<name>.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Rollback (run as ceyliving_migrator, after stopping the worker so it can't write new audit rows):
--   DROP INDEX "users_muted_until_idx";
--   DROP INDEX "custom_requests_status_updated_at_idx";
--   DROP INDEX "seller_orders_status_dispatched_at_idx";
--   DROP INDEX "seller_orders_status_accept_deadline_at_idx";
--   ALTER TABLE "seller_orders" DROP COLUMN "accept_deadline_at";
--   -- Only if no job has written an audit row yet; check first:
--   --   SELECT count(*) FROM audit_log WHERE actor_id IS NULL;
--   ALTER TABLE "audit_log" ALTER COLUMN "actor_id" SET NOT NULL;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261102150000_jobs_worker';
-- What can't be undone cleanly: once the worker has written audit rows (actor_id IS NULL), SET NOT NULL fails.
-- The app user can't UPDATE or DELETE audit rows (DB-09), and they are the only record of what the jobs did, so
-- keep the column nullable and roll back only the rest. The old app version runs fine with a nullable column; it
-- only ever inserts a real actor. Dropping accept_deadline_at loses any deadlines B08 has set by then.
-- Restoring the backup instead (pg_restore --clean --if-exists -d ceyliving <file>) puts the whole database back
-- to the moment of the dump, which also loses every order, payment and account change made since. Use it only
-- for a failed migration, not to undo one that worked.

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN "accept_deadline_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "actor_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "seller_orders_status_accept_deadline_at_idx" ON "seller_orders"("status", "accept_deadline_at");

-- CreateIndex
CREATE INDEX "seller_orders_status_dispatched_at_idx" ON "seller_orders"("status", "dispatched_at");

-- CreateIndex
CREATE INDEX "custom_requests_status_updated_at_idx" ON "custom_requests"("status", "updated_at");

-- CreateIndex
CREATE INDEX "users_muted_until_idx" ON "users"("muted_until") WHERE (posting_restriction = 'MUTED'::"PostingRestriction");
