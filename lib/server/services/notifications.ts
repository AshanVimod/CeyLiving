import "server-only";
import type { Notification } from "@/lib/types";
import type { Actor } from "../permissions";
import { notificationsOf } from "../repositories/people";
import { readStore, transaction } from "../store/dev-store";

/** RULE-N1: people only ever read and update their own notifications. */
export function myNotifications(actor: Actor, limit?: number): { items: Notification[]; unread: number } {
  const all = notificationsOf(actor.id, readStore());
  return { items: limit ? all.slice(0, limit) : all, unread: all.filter((n) => !n.readAt).length };
}

export async function markNotificationsRead(actor: Actor, ids?: string[]): Promise<void> {
  await transaction((db) => {
    const now = new Date().toISOString();
    db.notifications
      .filter((n) => n.userId === actor.id && !n.readAt && (!ids || ids.includes(n.id)))
      .forEach((n) => (n.readAt = now));
  });
}
