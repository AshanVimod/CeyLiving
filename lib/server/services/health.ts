import "server-only";
import { EXPECTED_MIGRATION } from "../db/expected-migration";
import { db } from "../db/tx";
import { migrationState, pingDatabase } from "../repositories/ops";

// OPS-05: is this web app ready for traffic? The answer is only yes or no; the reason goes to the log, never to the
// caller, so the endpoint tells an outsider nothing about the system.

/** The longest /api/ready waits for the database before answering 503. */
export const READY_TIMEOUT_MS = 2_000;

export type ReadyResult = { ok: true } | { ok: false; reason: "database" | "migration" | "timeout"; detail?: string };

export async function readiness(timeoutMs = READY_TIMEOUT_MS, migration = EXPECTED_MIGRATION): Promise<ReadyResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadyResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), timeoutMs);
  });
  const check = (async (): Promise<ReadyResult> => {
    try {
      await pingDatabase(db);
    } catch {
      return { ok: false, reason: "database" };
    }
    const state = await migrationState(db, migration).catch(() => "unreadable" as const);
    return state === "applied" ? { ok: true } : { ok: false, reason: "migration", detail: state };
  })();
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
