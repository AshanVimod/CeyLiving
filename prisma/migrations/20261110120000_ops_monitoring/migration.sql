-- B12: monitoring and security events (backend plan OPS-02, OPS-05 to OPS-07, A09). Only adds things (DB-11, expand
-- step), so the previous app version keeps working against this schema:
--   * ops_event_counts: how many security and error events of each kind happened in each 5-minute bucket. No people,
--     IPs or ids, only a kind, a time and a count. Rows older than 30 days are deleted by maintenance.cleanup.
--   * ops_alerts: when each kind of alert was last sent, so one goes out per kind per hour (OPS-06).
--   * ops_checkpoints: when a recurring task (payouts, and the backup from B14) last succeeded or failed.
--   * audit_log gains ip_hash and request_id (OPS-02). Both nullable with no default: adding them is metadata-only (no
--     table rewrite, a brief lock), and every row written before B12 stays valid with both NULL.
--   * ceyliving_app may read three columns of _prisma_migrations, so /api/ready can check the expected migration.
--
-- Backup first: `docker exec ceyliving-dev-postgres-1 pg_dump -U ceyliving_migrator -d ceyliving -Fc > .data/backups/before-b12-ops-monitoring.dump`
-- locally. In staging and production, use the provider's snapshot or the nightly dump (backend plan 17.4).
--
-- Rollback (run as ceyliving_migrator, after stopping the web app and the worker):
--   DROP TABLE "ops_event_counts", "ops_alerts", "ops_checkpoints";
--   ALTER TABLE "audit_log" DROP COLUMN "ip_hash", DROP COLUMN "request_id";
--   REVOKE SELECT ON "_prisma_migrations" FROM ceyliving_app;
--   DELETE FROM _prisma_migrations WHERE migration_name = '20261110120000_ops_monitoring';
-- What is lost: the event counters, the alert history, the checkpoints, and the IP hash and request ID on audit rows
-- written since B12. All of it is monitoring data; no order, payment or account data is touched. The previous app
-- version never reads any of it.

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN "ip_hash" TEXT,
ADD COLUMN "request_id" TEXT;

-- CreateTable
CREATE TABLE "ops_event_counts" (
    "kind" TEXT NOT NULL,
    "bucket_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "ops_event_counts_pkey" PRIMARY KEY ("kind","bucket_start")
);

-- CreateTable
CREATE TABLE "ops_alerts" (
    "kind" TEXT NOT NULL,
    "last_sent_at" TIMESTAMPTZ(3) NOT NULL,
    "last_count" INTEGER NOT NULL,

    CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "ops_checkpoints" (
    "name" TEXT NOT NULL,
    "last_ok_at" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ops_checkpoints_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "ops_event_counts_bucket_start_idx" ON "ops_event_counts"("bucket_start");

-- DB-07: a kind is a short fixed name (never free text that could carry personal data), and a count is positive.
ALTER TABLE "ops_event_counts" ADD CONSTRAINT "ops_event_counts_kind" CHECK ("kind" ~ '^[a-z_]{3,40}$');
ALTER TABLE "ops_event_counts" ADD CONSTRAINT "ops_event_counts_count" CHECK ("count" > 0);
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_kind" CHECK ("kind" ~ '^[a-z_]{3,40}$');
ALTER TABLE "ops_alerts" ADD CONSTRAINT "ops_alerts_last_count" CHECK ("last_count" > 0);
ALTER TABLE "ops_checkpoints" ADD CONSTRAINT "ops_checkpoints_name" CHECK ("name" ~ '^[a-z_]{3,40}$');
ALTER TABLE "ops_checkpoints" ADD CONSTRAINT "ops_checkpoints_some_run"
    CHECK ("last_ok_at" IS NOT NULL OR "last_failed_at" IS NOT NULL);
-- 12.4: an IP is only ever kept as its keyed hash (32 hex characters), never the address itself.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_ip_hash" CHECK ("ip_hash" ~ '^[0-9a-f]{32}$');
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_request_id" CHECK (char_length("request_id") BETWEEN 1 AND 64);

-- Grants: the new tables get SELECT, INSERT, UPDATE, DELETE from the init migration's default privileges.
-- OPS-05: /api/ready checks that this build's expected migration is applied. The app may read only the name and the
-- two timestamps, never the checksums or logs, and can't write there. The table doesn't exist while Prisma replays
-- migrations into its shadow database, hence the guard (as in the init migration).
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    GRANT SELECT ("migration_name", "finished_at", "rolled_back_at") ON "_prisma_migrations" TO ceyliving_app;
  END IF;
END
$$;
