import "server-only";
import { withTx } from "../db/tx";
import {
  deleteExpiredSessions,
  deleteExpiredVerifications,
  deleteOldAuthAttempts,
  deleteOldRateEvents,
} from "../repositories/people";
import { inBatches } from "./shared";

const DAY = 86_400_000;

/**
 * maintenance.cleanup (backend plan 10.2): deletes rows nothing reads any more. Rate events and sign-in attempt
 * counters older than a day (every SEC-A6 and AU-06 window is a day or shorter), expired sessions and expired email
 * links. Orphaned uploads join this list in B09. Deleting what is already gone deletes nothing (JOB-03).
 */
export async function cleanUpOldRows(now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY);
  return {
    rateEvents: await inBatches((limit) => withTx((tx) => deleteOldRateEvents(tx, dayAgo, limit))),
    authAttempts: await inBatches((limit) => withTx((tx) => deleteOldAuthAttempts(tx, dayAgo.getTime(), limit))),
    sessions: await inBatches((limit) => withTx((tx) => deleteExpiredSessions(tx, now, limit))),
    verifications: await inBatches((limit) => withTx((tx) => deleteExpiredVerifications(tx, now, limit))),
  };
}
