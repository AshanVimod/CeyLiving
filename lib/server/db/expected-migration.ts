/**
 * OPS-05: the newest migration this build needs. /api/ready answers 503 until it is applied. A database that is ahead
 * (a newer migration already ran, DB-11) is still ready. A test fails if this isn't the newest folder in
 * prisma/migrations, so update it with every migration (a standalone image has no prisma/ folder to read).
 */
export const EXPECTED_MIGRATION = "20261110130000_rate_limits_purge_raw_ips";
