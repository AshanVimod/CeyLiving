import "server-only";
import { ConflictError } from "../errors";

// The services check every rule before writing, so a database refusal only happens when two requests race. A
// unique-index clash then becomes a ConflictError with a message people can act on. Anything else (a CHECK
// constraint, a missing row) means a bug: it stays an unexpected error, which the action and route wrappers log
// and show as a generic message with a reference (OPS-03). Raw PostgreSQL text never reaches the page.

/** Unique indexes people can run into, and what to tell them. */
const CLASH_MESSAGES: Record<string, string> = {
  seller_applications_one_open_per_user: "You already have an open shop application.",
  shops_one_open_per_owner: "You already have a shop.",
  shops_slug_key: "That shop web address was just taken. Try again.",
  products_slug_key: "That item web address was just taken. Try again.",
  reviews_order_item_id_key: "You’ve already reviewed this item.",
  reports_one_open_per_reporter: "You’ve already reported this. We’ll look at it soon.",
  helpful_votes_pkey: "You’ve already marked this as helpful.",
};

const DEFAULT_CLASH = "This changed while you were working on it. Refresh the page and try again.";

/** Walks Prisma's error, the driver adapter's error and their causes. */
function* chain(error: unknown): Generator<Record<string, unknown>> {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    const e = current as Record<string, unknown>;
    yield e;
    const meta = e.meta as { driverAdapterError?: unknown } | undefined;
    current = meta?.driverAdapterError ?? e.cause;
  }
}

/** The unique index a write clashed with, or undefined when the error is not a unique violation. */
export function uniqueClash(error: unknown): { constraint?: string } | undefined {
  let isClash = false;
  let constraint: string | undefined;
  for (const e of chain(error)) {
    if (
      e.code === "P2002" ||
      e.code === "23505" ||
      e.originalCode === "23505" ||
      e.kind === "UniqueConstraintViolation"
    ) {
      isClash = true;
    }
    const named = (e.constraint as { index?: string } | string | undefined) ?? undefined;
    if (typeof named === "string") constraint ??= named;
    else if (named?.index) constraint ??= named.index;
    const message = typeof e.message === "string" ? e.message : "";
    constraint ??= Object.keys(CLASH_MESSAGES).find((name) => message.includes(name));
  }
  return isClash ? { constraint } : undefined;
}

/** A unique clash becomes a ConflictError; every other error is returned unchanged. */
export function translateDbError(error: unknown): unknown {
  const clash = uniqueClash(error);
  if (!clash) return error;
  const message = (clash.constraint && CLASH_MESSAGES[clash.constraint]) ?? DEFAULT_CLASH;
  return Object.assign(new ConflictError(message), { cause: error });
}
