import "server-only";
import type { HelpfulVote } from "@/lib/types";
import type { RoleChangeInput, VoteInput } from "@/lib/validation/more";
import { ForbiddenError, NotFoundError } from "../errors";
import { assertRole, type Actor } from "../permissions";
import { addNotification } from "../repositories/people";
import { readStore, transaction, type StoreData } from "../store/dev-store";
import { assertRateLimit, audit } from "./shared";

/**
 * FR-16: an admin promotes a customer to admin. RULE-M5: never another admin or themselves;
 * sellers change role only through the shop flow (closing a shop), so they're refused here.
 */
export async function changeRole(actor: Actor, input: RoleChangeInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await transaction((db) => {
    const target = db.users.find((u) => u.id === input.userId && !u.deletedAt);
    if (!target) throw new NotFoundError("User not found.");
    if (target.id === actor.id || target.role === "ADMIN") throw new ForbiddenError("Admins can’t change the role of another admin or themselves.");
    if (target.role === "SELLER") throw new ForbiddenError("Sellers change role only when their shop is closed.");
    const before = target.role;
    target.role = input.role;
    addNotification(db, target.id, "user.role", "Your account now has admin access", "/admin");
    audit(db, actor, "user.role_changed", "USER", target.id, { reason: input.reason, before, after: input.role });
  });
}

/** FR-19: toggle a "helpful" vote. Not on your own posts, only on visible ones, one per person. */
export async function toggleHelpful(actor: Actor, input: VoteInput, now = new Date()): Promise<{ voted: boolean; count: number }> {
  return transaction((db) => {
    const target = input.targetType === "REVIEW" ? db.reviews.find((r) => r.id === input.targetId) : db.questions.find((q) => q.id === input.targetId);
    if (!target || target.status !== "VISIBLE") throw new NotFoundError("That post isn’t available.");
    if (target.authorId === actor.id) throw new ForbiddenError("You can’t vote on your own post.");
    assertRateLimit(db, actor.id, "vote", now);
    const index = db.helpfulVotes.findIndex((v) => v.userId === actor.id && v.targetType === input.targetType && v.targetId === input.targetId);
    if (index >= 0) db.helpfulVotes.splice(index, 1);
    else db.helpfulVotes.push({ userId: actor.id, targetType: input.targetType, targetId: input.targetId, createdAt: now.toISOString() } satisfies HelpfulVote);
    return { voted: index < 0, count: db.helpfulVotes.filter((v) => v.targetType === input.targetType && v.targetId === input.targetId).length };
  });
}

/** Vote counts for many posts at once, and which of them the viewer has voted on. */
export function helpfulCounts(targetType: "REVIEW" | "QUESTION", ids: string[], viewerId?: string, db: StoreData = readStore()) {
  const wanted = new Set(ids);
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const v of db.helpfulVotes) {
    if (v.targetType !== targetType || !wanted.has(v.targetId)) continue;
    counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
    if (v.userId === viewerId) mine.add(v.targetId);
  }
  return { counts, mine };
}

/** FR-19: most helpful first, then newest. */
export function byHelpfulness<T extends { id: string; createdAt: string }>(items: T[], counts: Map<string, number>): T[] {
  return [...items].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || b.createdAt.localeCompare(a.createdAt));
}
