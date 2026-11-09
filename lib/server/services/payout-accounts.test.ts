// @vitest-environment node
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIELD_ENCRYPTION_DEV_KEY } from "@/lib/env";
import { getAuth } from "@/lib/server/better-auth";
import { payoutAccountContext } from "@/lib/server/crypto/contexts";
import { encryptField, keyIdOf } from "@/lib/server/crypto/field-encryption";
import { db, withTx } from "@/lib/server/db/tx";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "@/lib/server/errors";
import { logger } from "@/lib/server/observability/logger";
import {
  deletePayoutAccount,
  findPayoutAccount,
  findStoredPayoutAccount,
  replaceEncryptedNumber,
} from "@/lib/server/repositories/payout-accounts";
import { payoutSchema } from "@/lib/validation/shop";
import { changeData, migratorClient, readAll, user, withTestDatabase } from "@/test/db";
import { generatePayouts, markPayoutPaid, sellerPayoutSummary } from "./payouts";
import { reencryptPayoutAccounts, revealPayoutAccount, savePayoutDetails } from "./payout-accounts";
import { deleteMyAccount, exportMyData } from "./privacy";

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/headers", async () => (await import("@/test/auth")).nextHeaders);

// B11 (backend plan 12.4, G-09): bank details are encrypted, shown only as the last four digits, and revealed only to
// an admin who gives their password again, for one payout that can still be paid.

withTestDatabase();

const NUMBER = "7391058246";
/** Low-randomness test values, so a secret scanner has nothing to flag. */
const PASSWORD = "xxxxxxxxxxxx";
const WRONG = "yyyyyyyyyyyy";
const OTHER_KEY = Buffer.alloc(32, "another-test-key").toString("base64");
const details = {
  accountName: "Ruwan Wijesuriya",
  bankName: "Bank of Ceylon",
  branch: "Galle Fort",
  accountNumber: NUMBER,
};
const SELLER_SHOP = "shop_ambalangoda-mask-house";
const admin = () => user("user_admin");
const seller = () => user("user_seller");
const customer = () => user("user_customer");

async function givePassword(userId: string) {
  const context = await getAuth().$context;
  await context.internalAdapter.linkAccount({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await hashPassword(PASSWORD),
  });
}

/** A scheduled payout for the demo seller's shop, with bank details the test knows. */
async function scheduled() {
  await savePayoutDetails(seller(), details);
  const payouts = await generatePayouts(admin());
  const payout = payouts.find((p) => p.shopId === SELLER_SHOP) ?? payouts[0]!;
  return payout;
}

const reveal = (payoutId: string, password = PASSWORD) => revealPayoutAccount(admin(), { payoutId, password });
const audits = async (action: string) => (await readAll()).auditLog.filter((a) => a.action === action);

/** Every row of every table, as text, that contains `needle`. */
async function rowsContaining(needle: string): Promise<string[]> {
  const client = migratorClient();
  const tables = await client.$queryRaw<{ schema: string; name: string }[]>`
    SELECT schemaname AS schema, tablename AS name FROM pg_tables WHERE schemaname IN ('public', 'pgboss')`;
  const found: string[] = [];
  for (const { schema, name } of tables) {
    const rows = await client.$queryRawUnsafe<{ row: string }[]>(
      `SELECT t::text AS row FROM "${schema}"."${name}" t WHERE t::text LIKE $1`,
      `%${needle}%`,
    );
    found.push(...rows.map((r) => `${name}: ${r.row}`));
  }
  return found;
}

function captureLogs() {
  const lines: unknown[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
      lines.push(args);
    }) as never);
  }
  return lines;
}

beforeEach(async () => {
  await givePassword("user_admin");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("G-09 storing bank details", () => {
  it("G-09 no table holds the plain account number after a save, a replacement or a reveal", async () => {
    const payout = await scheduled();
    expect(await rowsContaining(NUMBER)).toEqual([]);
    await reveal(payout.id);
    expect(await rowsContaining(NUMBER)).toEqual([]);
    await savePayoutDetails(seller(), { ...details, accountNumber: "8800112233" });
    expect(await rowsContaining("8800112233")).toEqual([]);
    expect(await rowsContaining(NUMBER)).toEqual([]);
  });

  it("G-09 stores ciphertext and the last four digits", async () => {
    await savePayoutDetails(seller(), details);
    const stored = (await findStoredPayoutAccount(db, SELLER_SHOP))!;
    expect(stored.accountLast4).toBe("8246");
    expect(stored.accountNumberEnc).toMatch(/^v1\./);
    expect(stored.accountNumberEnc).not.toContain(NUMBER);
  });

  it("DB-07 the database refuses a plain account number and a bad last 4", async () => {
    await savePayoutDetails(seller(), details);
    const client = migratorClient();
    const where = { shopId: SELLER_SHOP };
    await expect(client.shopPayoutAccount.update({ where, data: { accountNumberEnc: NUMBER } })).rejects.toThrow();
    await expect(client.shopPayoutAccount.update({ where, data: { accountLast4: "12" } })).rejects.toThrow();
  });

  it("DB-10 the app user can read, write and delete payout accounts", async () => {
    await savePayoutDetails(seller(), details);
    await withTx((tx) => deletePayoutAccount(tx, SELLER_SHOP));
    expect(await findPayoutAccount(db, SELLER_SHOP)).toBeUndefined();
  });

  it("G-09 replacing an account leaves one row and clears verified_at", async () => {
    const payout = await scheduled();
    await markPayoutPaid(admin(), payout.id, "BOC-2026-1001");
    expect((await findPayoutAccount(db, payout.shopId))!.verifiedAt).toBeDefined();
    await savePayoutDetails(seller(), { ...details, accountNumber: "8800112233" });
    const account = (await findPayoutAccount(db, SELLER_SHOP))!;
    expect(account.verifiedAt).toBeUndefined();
    expect(account.accountLast4).toBe("2233");
    expect((await readAll()).payoutAccounts.filter((a) => a.shopId === SELLER_SHOP)).toHaveLength(1);
  });

  it("G-09 the form needs the holder's name and branch, and an 8 to 16 digit number", () => {
    expect(payoutSchema.safeParse(details).success).toBe(true);
    expect(payoutSchema.safeParse({ ...details, accountName: "" }).success).toBe(false);
    expect(payoutSchema.safeParse({ ...details, branch: "" }).success).toBe(false);
    expect(payoutSchema.safeParse({ ...details, accountNumber: "123" }).success).toBe(false);
  });

  it("SEC-A9 saving payout details is audited with the last 4 only", async () => {
    await savePayoutDetails(seller(), details);
    await savePayoutDetails(seller(), { ...details, accountNumber: "8800112233" });
    const rows = await audits("payout_account.saved");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      actorId: "user_seller",
      targetType: "SHOP",
      targetId: SELLER_SHOP,
      before: { accountLast4: "8246" },
      after: { accountLast4: "2233" },
    });
  });

  it("FR-13 replacing an account notifies and emails the seller, with no bank details", async () => {
    await withTx((tx) => deletePayoutAccount(tx, SELLER_SHOP));
    await savePayoutDetails(seller(), details);
    const changes = () => migratorClient().emailDelivery.findMany({ where: { template: "payout.account_changed" } });
    expect(await changes()).toHaveLength(0); // the first save isn't a change
    await savePayoutDetails(seller(), { ...details, accountNumber: "8800112233" });
    const emails = await changes();
    expect(emails).toHaveLength(1);
    expect(Object.keys(emails[0]!.data as object)).toEqual(["changedAt"]);
    expect((await readAll()).notifications.some((n) => n.type === "payout.account_changed")).toBe(true);
  });

  it("FR-13 sellers see only the last 4 digits", async () => {
    await savePayoutDetails(seller(), details);
    const summary = await sellerPayoutSummary(seller());
    expect(summary.account?.accountLast4).toBe("8246");
    expect(JSON.stringify(summary)).not.toContain(NUMBER);
    expect(JSON.stringify(summary)).not.toContain("accountNumberEnc");
  });

  it("BR-11 a shop with only the old masked value is skipped", async () => {
    await withTx((tx) => deletePayoutAccount(tx, SELLER_SHOP));
    await migratorClient().shop.update({ where: { id: SELLER_SHOP }, data: { payoutAccountMasked: "Old •••• 1111" } });
    expect((await generatePayouts(admin())).some((p) => p.shopId === SELLER_SHOP)).toBe(false);
  });

  it("DB-11 the old masked column is still written for an older app version", async () => {
    await savePayoutDetails(seller(), details);
    const row = await migratorClient().shop.findUnique({ where: { id: SELLER_SHOP } });
    expect(row?.payoutAccountMasked).toBe("Bank of Ceylon •••• 8246");
  });
});

describe("12.4 revealing bank details", () => {
  it("12.4 an admin with the right password gets the full details", async () => {
    const payout = await scheduled();
    expect(await reveal(payout.id)).toEqual({
      accountName: details.accountName,
      bankName: details.bankName,
      branch: details.branch,
      accountNumber: NUMBER,
    });
  });

  it("12.4 the reveal action needs a signed-in admin, the password, and answers only that request", async () => {
    const { revealPayoutAccountAction } = await import("@/lib/server/actions/extras");
    const { signInAs, signOutLocally } = await import("@/test/auth");
    const payout = await scheduled();
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [name, value] of Object.entries(fields)) data.set(name, value);
      return data;
    };
    try {
      expect(await revealPayoutAccountAction(null, form({ payoutId: payout.id, password: PASSWORD }))).toMatchObject({
        ok: false,
      });
      await signInAs("user_admin");
      expect(await revealPayoutAccountAction(null, form({ payoutId: payout.id }))).toMatchObject({
        ok: false,
        fieldErrors: { password: expect.any(String) },
      });
      expect(await revealPayoutAccountAction(null, form({ payoutId: payout.id, password: WRONG }))).toMatchObject({
        ok: false,
        fieldErrors: { password: "That isn’t your password." },
      });
      const shown = await revealPayoutAccountAction(null, form({ payoutId: payout.id, password: PASSWORD }));
      expect(shown).toMatchObject({ ok: true, account: { accountNumber: NUMBER, branch: details.branch } });
    } finally {
      signOutLocally();
    }
  });

  it("SEC-A9 a reveal writes one audit row naming the admin and the payout", async () => {
    const payout = await scheduled();
    const account = (await findStoredPayoutAccount(db, payout.shopId))!;
    await reveal(payout.id);
    const rows = await audits("payout_account.revealed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: "user_admin",
      targetType: "PAYOUT",
      targetId: payout.id,
      reason: `For payout ${payout.id}`,
      after: { shopId: payout.shopId, accountLast4: "8246", keyId: keyIdOf(account.accountNumberEnc) },
    });
  });

  it("SEC-A9 no audit row means no number", async () => {
    const payout = await scheduled();
    const client = migratorClient();
    await client.$executeRawUnsafe(
      `ALTER TABLE audit_log ADD CONSTRAINT b11_test_block CHECK (action <> 'payout_account.revealed') NOT VALID`,
    );
    try {
      await expect(reveal(payout.id)).rejects.toThrow();
      expect(await audits("payout_account.revealed")).toHaveLength(0);
    } finally {
      await client.$executeRawUnsafe(`ALTER TABLE audit_log DROP CONSTRAINT b11_test_block`);
    }
  });

  it("12.4 a reveal asks for the password every time, and a wrong one shows nothing", async () => {
    const payout = await scheduled();
    await expect(reveal(payout.id, WRONG)).rejects.toBeInstanceOf(ValidationError);
    expect(await audits("payout_account.revealed")).toHaveLength(0);
    expect(await audits("payout_account.reveal_failed")).toMatchObject([
      { actorId: "user_admin", targetId: payout.id, reason: "wrong_password" },
    ]);
    await reveal(payout.id);
    await expect(reveal(payout.id, WRONG)).rejects.toBeInstanceOf(ValidationError);
  });

  it("12.4 an admin with no password can't reveal", async () => {
    const payout = await scheduled();
    const context = await getAuth().$context;
    await context.internalAdapter.deleteAccounts("user_admin");
    await expect(reveal(payout.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await audits("payout_account.revealed")).toHaveLength(0);
  });

  it("AU-06 five failed attempts lock the reveal, even with the right password, and stop adding audit rows", async () => {
    const payout = await scheduled();
    for (let i = 0; i < 5; i++) {
      await expect(reveal(payout.id, WRONG)).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(reveal(payout.id)).rejects.toBeInstanceOf(RateLimitError);
    await expect(reveal(payout.id, WRONG)).rejects.toBeInstanceOf(RateLimitError);
    expect(await audits("payout_account.reveal_failed")).toHaveLength(5);
    const later = new Date(Date.now() + 16 * 60_000);
    await expect(
      revealPayoutAccount(admin(), { payoutId: payout.id, password: PASSWORD }, later),
    ).resolves.toBeDefined();
  });

  it("SEC-A1 sellers and customers can't reveal, and the attempt is audited", async () => {
    const payout = await scheduled();
    for (const person of [seller(), customer()]) {
      await expect(revealPayoutAccount(person, { payoutId: payout.id, password: PASSWORD })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    const failed = await audits("payout_account.reveal_failed");
    expect(failed.map((a) => a.reason)).toEqual(["refused", "refused"]);
  });

  it("AU-02 an admin without two-step can't reveal", async () => {
    const payout = await scheduled();
    await expect(
      revealPayoutAccount({ ...admin(), needsTwoStep: true }, { payoutId: payout.id, password: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("12.4 a paid, held or unknown payout can't be revealed", async () => {
    const payout = await scheduled();
    await expect(reveal("payout_nope")).rejects.toBeInstanceOf(NotFoundError);
    await migratorClient().shop.update({
      where: { id: payout.shopId },
      data: { payoutHoldReason: "Chargeback", payoutHeldAt: new Date() },
    });
    await expect(reveal(payout.id)).rejects.toBeInstanceOf(ConflictError);
    await migratorClient().shop.update({
      where: { id: payout.shopId },
      data: { payoutHoldReason: null, payoutHeldAt: null },
    });
    await markPayoutPaid(admin(), payout.id, "BOC-2026-1001");
    await expect(reveal(payout.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await audits("payout_account.revealed")).toHaveLength(0);
    expect((await audits("payout_account.reveal_failed")).map((a) => a.reason)).toEqual([
      "not_found",
      "not_payable",
      "not_payable",
    ]);
  });

  it("SEC-A6 reveals stop at the hourly limit", async () => {
    const payout = await scheduled();
    const at = new Date();
    await changeData((data) => {
      for (let i = 0; i < 60; i++)
        data.rateEvents.push({ userId: "user_admin", kind: "payoutReveal", at: at.toISOString() });
    });
    await givePassword("user_admin"); // changeData reloads the tables it knows about
    await expect(reveal(payout.id)).rejects.toBeInstanceOf(RateLimitError);
    expect((await audits("payout_account.reveal_failed")).map((a) => a.reason)).toEqual(["hourly_limit"]);
  });

  it("12.4 a wrong key refuses the reveal, audits the failure, and payouts still work", async () => {
    const payout = await scheduled();
    vi.stubEnv("FIELD_ENCRYPTION_KEY", OTHER_KEY);
    const error = (await reveal(payout.id).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain("Nothing was shown");
    expect(await audits("payout_account.revealed")).toHaveLength(0);
    expect((await audits("payout_account.reveal_failed"))[0]?.reason).toBe("decrypt_failed:UNKNOWN_KEY");
    expect(await findPayoutAccount(db, payout.shopId)).toBeDefined();
    await markPayoutPaid(admin(), payout.id, "BOC-2026-1001");
    await savePayoutDetails(seller(), { ...details, accountNumber: "8800112233" });
  });

  it("OPS-01 saving, revealing and a wrong key never log bank details", async () => {
    const lines = captureLogs();
    const payout = await scheduled();
    await reveal(payout.id);
    await reveal(payout.id, WRONG).catch(() => undefined);
    vi.stubEnv("FIELD_ENCRYPTION_KEY", OTHER_KEY);
    await reveal(payout.id).catch(() => undefined);
    const all = JSON.stringify(lines);
    expect(all).toContain("payout_account.reveal_failed");
    for (const secret of [NUMBER, details.accountName, details.bankName, PASSWORD, WRONG, OTHER_KEY]) {
      expect(all).not.toContain(secret);
    }
  });

  it("OPS-01 the logger redacts bank fields added in B11", async () => {
    const { createLogger } = await import("@/lib/server/observability/logger");
    const written: string[] = [];
    const log = createLogger({ level: "info", destination: { write: (line: string) => void written.push(line) } });
    log.info({ account: { accountName: "A Name", account_number_enc: "v1.abc", bankName: "A Bank" } }, "x");
    expect(written.join()).not.toMatch(/A Name|v1\.abc|A Bank/);
  });
});

describe("FR-17 export and deletion", () => {
  it("FR-17 export shows the last 4 and never the full number", async () => {
    await savePayoutDetails(seller(), details);
    const exported = await exportMyData(seller());
    expect(exported.payoutAccounts).toEqual([
      expect.objectContaining({ bankName: "Bank of Ceylon", branch: "Galle Fort", accountNumberLast4: "8246" }),
    ]);
    const text = JSON.stringify(exported);
    expect(text).not.toContain(NUMBER);
    expect(text).not.toContain("v1.");
  });

  /** The seller's shop closed, with nothing left to pay unless a test adds it. */
  async function closeSellerShop({ settled = true } = {}) {
    await changeData((data) => {
      data.shops.find((s) => s.id === SELLER_SHOP)!.status = "CLOSED";
      for (const so of data.sellerOrders) if (settled && so.shopId === SELLER_SHOP) so.status = "CANCELLED";
    });
  }

  it("FR-17 deletion removes the payout account and the masked text", async () => {
    await closeSellerShop();
    await deleteMyAccount(seller());
    expect(await findPayoutAccount(db, SELLER_SHOP)).toBeUndefined();
    const row = await migratorClient().shop.findUnique({ where: { id: SELLER_SHOP } });
    expect(row?.payoutAccountMasked).toBeNull();
    expect(await audits("payout_account.deleted")).toMatchObject([{ actorId: "user_seller", targetId: SELLER_SHOP }]);
  });

  it("FR-17 deletion waits while a payout is still owed", async () => {
    await closeSellerShop({ settled: false });
    const owed = (await readAll()).sellerOrders.some(
      (so) => so.shopId === SELLER_SHOP && so.status === "COMPLETED" && !so.payoutId,
    );
    expect(owed).toBe(true);
    await expect(deleteMyAccount(seller())).rejects.toBeInstanceOf(ConflictError);
    expect(await findPayoutAccount(db, SELLER_SHOP)).toBeDefined();
  });
});

describe("12.4 key rotation", () => {
  const rotateToOtherKey = () => {
    vi.stubEnv("FIELD_ENCRYPTION_KEY", OTHER_KEY);
    vi.stubEnv("FIELD_ENCRYPTION_PREVIOUS_KEYS", FIELD_ENCRYPTION_DEV_KEY);
  };

  it("12.4 re-encrypting moves every row to the current key, and the details still reveal", async () => {
    const payout = await scheduled();
    const total = (await readAll()).payoutAccounts.length;
    rotateToOtherKey();
    expect(await reencryptPayoutAccounts({ check: true })).toMatchObject({ rotated: 0, alreadyCurrent: 0, failed: 0 });
    expect(await reencryptPayoutAccounts()).toMatchObject({ rotated: total, alreadyCurrent: 0, failed: 0 });
    vi.stubEnv("FIELD_ENCRYPTION_PREVIOUS_KEYS", "");
    expect((await reveal(payout.id)).accountNumber).toBe(NUMBER);
    expect(await audits("payout_account.rekeyed")).toMatchObject([{ after: { rotated: total, failed: 0 } }]);
  });

  it("12.4 running it again changes nothing", async () => {
    const total = (await readAll()).payoutAccounts.length;
    rotateToOtherKey();
    await reencryptPayoutAccounts();
    const before = await readAll();
    expect(await reencryptPayoutAccounts()).toMatchObject({ rotated: 0, alreadyCurrent: total, failed: 0 });
    expect((await readAll()).payoutAccounts).toEqual(before.payoutAccounts);
  });

  it("12.4 a seller's save during the run is kept", async () => {
    await savePayoutDetails(seller(), details);
    const read = (await findStoredPayoutAccount(db, SELLER_SHOP))!.accountNumberEnc;
    await savePayoutDetails(seller(), { ...details, accountNumber: "8800112233" });
    const saved = (await findStoredPayoutAccount(db, SELLER_SHOP))!.accountNumberEnc;
    const stale = encryptField(NUMBER, payoutAccountContext(SELLER_SHOP));
    expect(await withTx((tx) => replaceEncryptedNumber(tx, SELLER_SHOP, read, stale))).toBe(false);
    expect((await findStoredPayoutAccount(db, SELLER_SHOP))!.accountNumberEnc).toBe(saved);
  });

  it("12.4 a row that can't be read is reported and left alone", async () => {
    vi.stubEnv("FIELD_ENCRYPTION_KEY", OTHER_KEY);
    const unreadable = encryptField(NUMBER, payoutAccountContext(SELLER_SHOP));
    vi.stubEnv("FIELD_ENCRYPTION_KEY", "");
    await migratorClient().shopPayoutAccount.update({
      where: { shopId: SELLER_SHOP },
      data: { accountNumberEnc: unreadable },
    });
    const lines = captureLogs();
    expect((await reencryptPayoutAccounts({ check: true })).failed).toBe(1);
    expect((await reencryptPayoutAccounts()).failed).toBe(1);
    expect((await findStoredPayoutAccount(db, SELLER_SHOP))!.accountNumberEnc).toBe(unreadable);
    expect(JSON.stringify(lines)).not.toContain(unreadable);
  });
});
