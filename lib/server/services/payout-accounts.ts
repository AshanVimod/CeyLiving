import "server-only";
import { RATE_LIMITS } from "@/lib/config";
import type { PayoutRevealInput, PayoutInput } from "@/lib/validation/shop";
import { payoutAccountContext } from "../crypto/contexts";
import {
  decryptField,
  encryptField,
  FieldEncryptionError,
  isCurrentKey,
  keyIdOf,
  rotateField,
} from "../crypto/field-encryption";
import { db, withTx } from "../db/tx";
import { queueEmail } from "../email/queue";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "../errors";
import { logger } from "../observability/logger";
import { checkOwnPassword } from "../password-check";
import { assertRole, shopOfSeller, type Actor } from "../permissions";
import { findShopById } from "../repositories/catalogue";
import { findPayout } from "../repositories/commerce";
import {
  findPayoutAccount,
  findStoredPayoutAccount,
  replaceEncryptedNumber,
  savePayoutAccount,
  storedPayoutAccountsAfter,
} from "../repositories/payout-accounts";
import { addNotification, countRateEvents, insertRateEvent } from "../repositories/people";
import { assertRateLimit, audit, JOB_BATCH_SIZE, WORKER } from "./shared";
import { activateIfReady } from "./shops";

// B11 (backend plan 12.4, G-09). Only the web app and the re-encrypt script import this file, because it is the code
// that uses the encryption key; the worker must not (a test walks its imports).

/** FR-13: the number is encrypted here, so the plain value never reaches a repository, Prisma or an error from them. */
export async function savePayoutDetails(actor: Actor, input: PayoutInput, now = new Date()): Promise<void> {
  await withTx(async (tx) => {
    const shop = await shopOfSeller(actor, tx);
    const previous = await findPayoutAccount(tx, shop.id);
    const accountLast4 = input.accountNumber.slice(-4);
    await savePayoutAccount(
      tx,
      {
        shopId: shop.id,
        bankName: input.bankName,
        branch: input.branch,
        accountName: input.accountName,
        accountNumberEnc: encryptField(input.accountNumber, payoutAccountContext(shop.id)),
        accountLast4,
      },
      now,
    );
    await audit(tx, actor, "payout_account.saved", "SHOP", shop.id, {
      before: previous && { bankName: previous.bankName, accountLast4: previous.accountLast4 },
      after: { bankName: input.bankName, accountLast4 },
    });
    // A hijacked session could otherwise redirect a seller's payouts unnoticed.
    if (previous) {
      await addNotification(
        tx,
        actor.id,
        "payout.account_changed",
        "Your payout bank account was changed",
        "/seller/payouts",
      );
      await queueEmail(tx, "payout.account_changed", {
        userId: actor.id,
        key: `${shop.id}:${now.toISOString()}`,
        data: { changedAt: now.toISOString() },
      });
    }
    await activateIfReady(tx, shop.id);
  });
}

export interface RevealedPayoutAccount {
  accountName: string;
  bankName: string;
  branch: string;
  accountNumber: string;
}

/** The wrong password; it counts towards the lock. */
class WrongPasswordError extends ValidationError {
  constructor() {
    super("Check your password.", { password: "That isn’t your password." });
  }
}

/** Why a reveal failed, for the audit row, and whether it counts towards the lock. Never holds a value. */
function failureOf(error: unknown): { reason: string; counts: boolean } {
  if (error instanceof WrongPasswordError) return { reason: "wrong_password", counts: true };
  if (error instanceof ForbiddenError) return { reason: "refused", counts: true };
  if (error instanceof RateLimitError) return { reason: "hourly_limit", counts: false };
  if (error instanceof NotFoundError) return { reason: "not_found", counts: false };
  if (error instanceof FieldEncryptionError) return { reason: `decrypt_failed:${error.code}`, counts: false };
  if (error instanceof DomainError) return { reason: "not_payable", counts: false };
  return { reason: "error", counts: false };
}

/** Failed attempts are recorded on their own, because the attempt's transaction rolled back or never started. */
async function recordFailedReveal(actor: Actor, payoutId: string, error: unknown, now: Date): Promise<void> {
  const { reason, counts } = failureOf(error);
  const level = error instanceof FieldEncryptionError || reason === "error" ? "error" : "warn";
  logger[level]({ actorId: actor.id, payoutId, reason }, "payout_account.reveal_failed");
  try {
    await withTx(async (tx) => {
      if (counts) await insertRateEvent(tx, { userId: actor.id, kind: "payoutRevealFailure", at: now.toISOString() });
      await audit(tx, actor, "payout_account.reveal_failed", "PAYOUT", payoutId, { reason });
    });
  } catch (recordError) {
    logger.error({ err: recordError, payoutId }, "payout_account.reveal_failure_not_recorded");
  }
}

async function assertNotLocked(actor: Actor, now: Date): Promise<void> {
  const { max, windowMs } = RATE_LIMITS.payoutRevealFailure;
  if ((await countRateEvents(db, actor.id, "payoutRevealFailure", now.getTime() - windowMs)) < max) return;
  logger.warn({ actorId: actor.id }, "payout_account.reveal_locked");
  throw new RateLimitError("Too many failed attempts. Try again in 15 minutes.");
}

async function assertPassword(actor: Actor, password: string): Promise<void> {
  const check = await checkOwnPassword(actor.id, password);
  if (check === "wrong") throw new WrongPasswordError();
  if (check === "none") {
    throw new ConflictError("Your account has no password. Set one with “Forgot password”, then try again.");
  }
}

/**
 * 12.4: an admin's "reveal for payout", for one payout that can still be paid. The password is asked for every time.
 * The audit row is written in the same transaction as the read, and the details are returned only once it commits, so
 * no audit row means no number. A failed attempt is audited too, except one already stopped by the lock.
 */
export async function revealPayoutAccount(
  actor: Actor,
  { payoutId, password }: PayoutRevealInput,
  now = new Date(),
): Promise<RevealedPayoutAccount> {
  await assertNotLocked(actor, now);
  try {
    assertRole(actor, ["ADMIN"]);
    await assertPassword(actor, password); // outside the transaction: hashing is deliberately slow
    return await withTx(async (tx) => {
      const payout = await findPayout(tx, payoutId);
      if (!payout) throw new NotFoundError("Payout not found.");
      if (payout.status !== "SCHEDULED")
        throw new ConflictError("Only a scheduled payout’s bank details can be shown.");
      const shop = await findShopById(tx, payout.shopId);
      if (shop?.payoutHoldReason) throw new ConflictError("This shop’s payouts are on hold.");
      await assertRateLimit(tx, actor.id, "payoutReveal", now);
      const account = await findStoredPayoutAccount(tx, payout.shopId);
      if (!account) throw new ConflictError("The seller hasn’t added their full bank details yet.");
      const accountNumber = decryptField(account.accountNumberEnc, payoutAccountContext(payout.shopId));
      await audit(tx, actor, "payout_account.revealed", "PAYOUT", payout.id, {
        reason: `For payout ${payout.id}`,
        after: {
          shopId: payout.shopId,
          accountLast4: account.accountLast4,
          keyId: keyIdOf(account.accountNumberEnc),
        },
      });
      return { accountName: account.accountName, bankName: account.bankName, branch: account.branch, accountNumber };
    });
  } catch (error) {
    await recordFailedReveal(actor, payoutId, error, now);
    if (error instanceof FieldEncryptionError) {
      throw new ConflictError(
        "These bank details can’t be read right now. Nothing was shown. Check the encryption key.",
      );
    }
    throw error;
  }
}

export interface ReencryptReport {
  byKey: Record<string, number>;
  rotated: number;
  alreadyCurrent: number;
  /** Changed by a seller while the run was working; their new value already uses the current key. */
  skipped: number;
  failed: number;
}

/**
 * 12.4 key rotation (`npm run payouts:reencrypt`): moves every row to the current key, or with `check` only reports.
 * Each row is its own conditional update, so the run can be stopped and started again. Reports counts, never values.
 */
export async function reencryptPayoutAccounts({ check = false } = {}): Promise<ReencryptReport> {
  const report: ReencryptReport = { byKey: {}, rotated: 0, alreadyCurrent: 0, skipped: 0, failed: 0 };
  let after: string | undefined;
  for (;;) {
    const rows = await storedPayoutAccountsAfter(db, after, JOB_BATCH_SIZE);
    for (const { shopId, accountNumberEnc } of rows) {
      const context = payoutAccountContext(shopId);
      try {
        const keyId = keyIdOf(accountNumberEnc);
        report.byKey[keyId] = (report.byKey[keyId] ?? 0) + 1;
        if (check) decryptField(accountNumberEnc, context);
        if (isCurrentKey(accountNumberEnc)) {
          report.alreadyCurrent += 1;
        } else if (!check) {
          const next = rotateField(accountNumberEnc, context);
          const changed = await withTx((tx) => replaceEncryptedNumber(tx, shopId, accountNumberEnc, next));
          report[changed ? "rotated" : "skipped"] += 1;
        }
      } catch (error) {
        if (!(error instanceof FieldEncryptionError)) throw error;
        report.failed += 1;
        logger.error({ shopId, code: error.code }, "payout_account.reencrypt_failed");
      }
    }
    if (rows.length < JOB_BATCH_SIZE) break;
    after = rows.at(-1)!.shopId;
  }
  if (!check && (report.rotated || report.failed)) {
    await withTx((tx) =>
      audit(tx, WORKER, "payout_account.rekeyed", "SYSTEM", "field-encryption", {
        reason: "Encryption key rotation (npm run payouts:reencrypt)",
        after: { rotated: report.rotated, failed: report.failed },
      }),
    );
  }
  return report;
}
