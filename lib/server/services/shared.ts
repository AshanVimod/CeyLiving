import "server-only";
import { RATE_LIMITS, SHOP_SLUG } from "@/lib/config";
import { ConflictError, RateLimitError } from "../errors";
import { addAuditEntry } from "../repositories/people";
import type { Actor } from "../permissions";
import type { StoreData } from "../store/dev-store";

/** SEC-A6: counts this user's recent posts of one kind and records the new one. */
export function assertRateLimit(db: StoreData, userId: string, kind: keyof typeof RATE_LIMITS, now = new Date()) {
  const { max, windowMs } = RATE_LIMITS[kind];
  const since = now.getTime() - windowMs;
  db.rateEvents = db.rateEvents.filter((e) => Date.parse(e.at) >= now.getTime() - 86_400_000);
  const recent = db.rateEvents.filter((e) => e.userId === userId && e.kind === kind && Date.parse(e.at) >= since).length;
  if (recent >= max) throw new RateLimitError();
  db.rateEvents.push({ userId, kind, at: now.toISOString() });
}

/** One table of allowed moves per status flow (feature spec section 8); anything else is a conflict. */
export function assertTransition<S extends string>(table: Partial<Record<S, readonly S[]>>, from: S, to: S, what: string) {
  if (!table[from]?.includes(to)) throw new ConflictError(`This ${what} can’t move from ${label(from)} to ${label(to)}.`);
}

function label(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

/** SEC-A9: admin actions write their audit row in the same transaction as the change. */
export function audit(db: StoreData, actor: Actor, action: string, targetType: string, targetId: string, extra: { reason?: string; before?: unknown; after?: unknown } = {}) {
  addAuditEntry(db, { actorId: actor.id, action, targetType, targetId, ...extra });
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
