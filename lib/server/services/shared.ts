import "server-only";
import { RATE_LIMITS, SHOP_SLUG } from "@/lib/config";
import { ConflictError, RateLimitError } from "../errors";
import type { Tx } from "../db/tx";
import { currentRequestContext } from "../observability/request-context";
import { addAuditEntry, countRateEvents, insertRateEvent, pruneRateEvents } from "../repositories/people";
import type { Actor } from "../permissions";

/** SEC-A6: counts this user's recent posts of one kind and records the new one. */
export async function assertRateLimit(tx: Tx, userId: string, kind: keyof typeof RATE_LIMITS, now = new Date()) {
  const { max, windowMs } = RATE_LIMITS[kind];
  await pruneRateEvents(tx, now.getTime() - 86_400_000);
  if ((await countRateEvents(tx, userId, kind, now.getTime() - windowMs)) >= max) throw new RateLimitError();
  await insertRateEvent(tx, { userId, kind, at: now.toISOString() });
}

/** One table of allowed moves per status flow (feature spec section 8); anything else is a conflict. */
export function assertTransition<S extends string>(
  table: Partial<Record<S, readonly S[]>>,
  from: S,
  to: S,
  what: string,
) {
  if (!table[from]?.includes(to))
    throw new ConflictError(`This ${what} can’t move from ${label(from)} to ${label(to)}.`);
}

/** DB-06: a conditional update found the status already changed (another tab, person or job got there first). */
export function staleStatus(what: string): ConflictError {
  return new ConflictError(`This ${what} was just changed elsewhere. Reload the page and try again.`);
}

function label(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

/** Changes made by a scheduled job rather than a person (B06). Audit rows record it as a missing actor. */
export const WORKER = "worker" as const;

/** SEC-A9: admin actions (and scheduled jobs' changes) write their audit row in the same transaction. */
export async function audit(
  tx: Tx,
  actor: Actor | typeof WORKER,
  action: string,
  targetType: string,
  targetId: string,
  extra: { reason?: string; before?: unknown; after?: unknown } = {},
) {
  const actorId = actor === WORKER ? undefined : actor.id;
  // OPS-02: the request behind the change, so the row links to its logs and Sentry event. None in the worker.
  const context = currentRequestContext();
  await addAuditEntry(tx, {
    actorId,
    action,
    targetType,
    targetId,
    ...extra,
    requestId: context?.requestId,
    ipHash: context?.ipHash,
  });
}

/** JOB-06: rows a scheduled job changes per transaction. */
export const JOB_BATCH_SIZE = 100;

/**
 * JOB-06: runs `batch` (one transaction each) until it handles fewer than `size` rows, and returns the total. A
 * crash part-way loses only the open batch; the next run picks up what is left, because each batch only selects
 * rows still in their old state.
 */
export async function inBatches(batch: (limit: number) => Promise<number>, size = JOB_BATCH_SIZE): Promise<number> {
  let total = 0;
  for (;;) {
    const handled = await batch(size);
    total += handled;
    if (handled < size) return total;
  }
}

/** RULE-S2: lowercase words joined by hyphens. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SHOP_SLUG.max)
    .replace(/-+$/g, "");
}

/** Makes `base` unique among `taken` by adding -2, -3 and so on. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base || "item";
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function nowIso(now = new Date()) {
  return now.toISOString();
}
