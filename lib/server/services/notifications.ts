import "server-only";
import type { Notification } from "@/lib/types";
import { db, withTx } from "../db/tx";
import type { Actor } from "../permissions";
import {
  addNotifications,
  listAdminIds,
  markNotificationsRead as markRead,
  notificationsOf,
} from "../repositories/people";

/** RULE-N1: people only ever read and update their own notifications. */
export async function myNotifications(
  actor: Actor,
  limit?: number,
): Promise<{ items: Notification[]; unread: number }> {
  const all = await notificationsOf(db, actor.id);
  return { items: limit ? all.slice(0, limit) : all, unread: all.filter((n) => !n.readAt).length };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]): Promise<void> {
  await withTx((tx) => markRead(tx, actor.id, new Date().toISOString(), ids));
}

/**
 * JOB-04: a background job failed its last try. Every admin is told (OPS-06 adds email or chat alerts later). The
 * job id is in the link, so a repeated alert for the same job is easy to spot; job details stay in the logs.
 */
export async function alertAdminsOfFailedJob(jobName: string, jobId: string): Promise<void> {
  await withTx(async (tx) => {
    const adminIds = await listAdminIds(tx);
    await addNotifications(
      tx,
      adminIds.map((userId) => ({
        userId,
        type: "job.failed",
        title: `Background job ${jobName} failed after every retry (job ${jobId}). Check the worker logs.`,
        href: "/admin",
      })),
    );
  });
}
