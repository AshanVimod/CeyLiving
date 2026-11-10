-- B12 (backend plan 12.4): one-off removal of Better Auth's sign-in limit rows written before this release. Their keys
-- were `<ip>|<path>` with the visitor's real address. From this release Better Auth gets a keyed stand-in instead
-- (lib/server/security/ip.ts), so new rows never hold one.
--
-- Data only, no schema change. Our own counters (keys starting `ceyliving:`) hold IP hashes already and stay. Every
-- row deleted here is a counter with a window of 15 minutes or less, so the only effect is that some visitors' limits
-- start over early. Rows the previous app version writes while this release rolls out are deleted by the hourly
-- rateLimits.prune job within the hour.
--
-- No backup needed and no rollback: the rows are short-lived counters that nothing reads after their window, and
-- keeping raw IPs is what this removes. Prisma runs it once; run again by hand, it would also start the stand-in
-- counters over, which is just as harmless.

DELETE FROM "rate_limits" WHERE "key" NOT LIKE 'ceyliving:%';
