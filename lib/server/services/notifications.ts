import "server-only";
import type { Notification } from "@/lib/types";
import { db, withTx } from "../db/tx";
import type { Actor } from "../permissions";
import { markNotificationsRead as markRead, notificationsOf } from "../repositories/people";

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
