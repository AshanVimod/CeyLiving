import "server-only";
import type { RoleChangeInput, VoteInput } from "@/lib/validation/more";
import { db, withTx, type Tx } from "../db/tx";
import { ForbiddenError, NotFoundError } from "../errors";
import { assertRole, type Actor } from "../permissions";
import { countVotes, deleteVote, findQuestion, findReview, insertVote, votesFor } from "../repositories/content";
import { addNotification, findUserById, updateUser } from "../repositories/people";
import { assertRateLimit, audit } from "./shared";

/**
 * FR-16: an admin promotes a customer to admin. RULE-M5: never another admin or themselves;
 * sellers change role only through the shop flow (closing a shop), so they're refused here.
 */
export async function changeRole(actor: Actor, input: RoleChangeInput): Promise<void> {
  assertRole(actor, ["ADMIN"]);
  await withTx(async (tx) => {
    const target = await findUserById(tx, input.userId);
    if (!target || target.deletedAt) throw new NotFoundError("User not found.");
    if (target.id === actor.id || target.role === "ADMIN")
      throw new ForbiddenError("Admins can’t change the role of another admin or themselves.");
    if (target.role === "SELLER") throw new ForbiddenError("Sellers change role only when their shop is closed.");
    const before = target.role;
    await updateUser(tx, target.id, { role: input.role });
    await addNotification(tx, target.id, "user.role", "Your account now has admin access", "/admin");
    await audit(tx, actor, "user.role_changed", "USER", target.id, { reason: input.reason, before, after: input.role });
  });
}

/** FR-19: toggle a "helpful" vote. Not on your own posts, only on visible ones, one per person. */
export async function toggleHelpful(
  actor: Actor,
  input: VoteInput,
  now = new Date(),
): Promise<{ voted: boolean; count: number }> {
  return withTx(async (tx) => {
    const target =
      input.targetType === "REVIEW" ? await findReview(tx, input.targetId) : await findQuestion(tx, input.targetId);
    if (!target || target.status !== "VISIBLE") throw new NotFoundError("That post isn’t available.");
    if (target.authorId === actor.id) throw new ForbiddenError("You can’t vote on your own post.");
    await assertRateLimit(tx, actor.id, "vote", now);
    const removed = await deleteVote(tx, actor.id, input.targetType, input.targetId);
    if (!removed)
      await insertVote(tx, {
        userId: actor.id,
        targetType: input.targetType,
        targetId: input.targetId,
        createdAt: now.toISOString(),
      });
    return { voted: !removed, count: await countVotes(tx, input.targetType, input.targetId) };
  });
}

/** Vote counts for many posts at once, and which of them the viewer has voted on. */
export async function helpfulCounts(targetType: "REVIEW" | "QUESTION", ids: string[], viewerId?: string, tx: Tx = db) {
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const v of await votesFor(tx, targetType, ids)) {
    counts.set(v.targetId, (counts.get(v.targetId) ?? 0) + 1);
    if (v.userId === viewerId) mine.add(v.targetId);
  }
  return { counts, mine };
}

/** FR-19: most helpful first, then newest. */
export function byHelpfulness<T extends { id: string; createdAt: string }>(
  items: T[],
  counts: Map<string, number>,
): T[] {
  return [...items].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || b.createdAt.localeCompare(a.createdAt),
  );
}
