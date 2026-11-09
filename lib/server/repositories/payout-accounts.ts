import "server-only";
import type { PayoutAccount, StoredPayoutAccount } from "@/lib/types";
import { clientOf, writableClientOf, type Tx } from "../db/tx";

// B11 (12.4, G-09): shop_payout_accounts. Everything here returns the showable fields, except the two functions marked
// below, which are the only ones that select the encrypted number.

const SHOWABLE = {
  shopId: true,
  bankName: true,
  branch: true,
  accountName: true,
  accountLast4: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface ShowableRow {
  shopId: string;
  bankName: string;
  branch: string;
  accountName: string;
  accountLast4: string;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPayoutAccount(row: ShowableRow): PayoutAccount {
  return {
    shopId: row.shopId,
    bankName: row.bankName,
    branch: row.branch,
    accountName: row.accountName,
    accountLast4: row.accountLast4,
    verifiedAt: row.verifiedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function hasPayoutAccount(tx: Tx, shopId: string): Promise<boolean> {
  const row = await clientOf(tx).shopPayoutAccount.findUnique({ where: { shopId }, select: { shopId: true } });
  return Boolean(row);
}

export async function findPayoutAccount(tx: Tx, shopId: string): Promise<PayoutAccount | undefined> {
  const row = await clientOf(tx).shopPayoutAccount.findUnique({ where: { shopId }, select: SHOWABLE });
  return row ? toPayoutAccount(row) : undefined;
}

/** One query for a whole list (the admin's payouts page). */
export async function payoutAccountsOfShops(tx: Tx, shopIds: string[]): Promise<PayoutAccount[]> {
  if (!shopIds.length) return [];
  const rows = await clientOf(tx).shopPayoutAccount.findMany({ where: { shopId: { in: shopIds } }, select: SHOWABLE });
  return rows.map(toPayoutAccount);
}

/** Every shop the person owns or has owned, closed ones too (FR-17). */
export async function payoutAccountsOfOwner(tx: Tx, ownerId: string): Promise<PayoutAccount[]> {
  const rows = await clientOf(tx).shopPayoutAccount.findMany({
    where: { shop: { ownerId } },
    select: SHOWABLE,
    orderBy: { shopId: "asc" },
  });
  return rows.map(toPayoutAccount);
}

/** Selects the encrypted number. Only the reveal may call this. */
export async function findStoredPayoutAccount(tx: Tx, shopId: string): Promise<StoredPayoutAccount | undefined> {
  const row = await clientOf(tx).shopPayoutAccount.findUnique({
    where: { shopId },
    select: { ...SHOWABLE, accountNumberEnc: true },
  });
  return row ? { ...toPayoutAccount(row), accountNumberEnc: row.accountNumberEnc } : undefined;
}

/** Selects the encrypted numbers, in shop id order. Only the re-encrypt run may call this. */
export async function storedPayoutAccountsAfter(
  tx: Tx,
  afterShopId: string | undefined,
  limit: number,
): Promise<{ shopId: string; accountNumberEnc: string }[]> {
  return clientOf(tx).shopPayoutAccount.findMany({
    where: afterShopId ? { shopId: { gt: afterShopId } } : {},
    select: { shopId: true, accountNumberEnc: true },
    orderBy: { shopId: "asc" },
    take: limit,
  });
}

/**
 * Adds or replaces a shop's account; a replacement counts as unverified again. Also writes the old masked column
 * (DB-11, expand step), so an older app version still works after a rollback.
 */
export async function savePayoutAccount(
  tx: Tx,
  account: Omit<StoredPayoutAccount, "verifiedAt" | "createdAt" | "updatedAt">,
  now: Date,
): Promise<void> {
  const { shopId, ...details } = account;
  const client = writableClientOf(tx);
  await client.shopPayoutAccount.upsert({
    where: { shopId },
    create: { shopId, ...details, createdAt: now, updatedAt: now },
    update: { ...details, verifiedAt: null, updatedAt: now },
  });
  await client.shop.updateMany({
    where: { id: shopId },
    data: { payoutAccountMasked: `${account.bankName} •••• ${account.accountLast4}`, updatedAt: now },
  });
}

/** The first recorded transfer marks the account as verified; later ones change nothing. */
export async function markPayoutAccountVerified(tx: Tx, shopId: string, now: Date): Promise<void> {
  await writableClientOf(tx).shopPayoutAccount.updateMany({
    where: { shopId, verifiedAt: null },
    data: { verifiedAt: now },
  });
}

/** Key rotation: only if the row still holds what was read, so a seller's save during the run isn't overwritten. */
export async function replaceEncryptedNumber(tx: Tx, shopId: string, expected: string, next: string): Promise<boolean> {
  const { count } = await writableClientOf(tx).shopPayoutAccount.updateMany({
    where: { shopId, accountNumberEnc: expected },
    data: { accountNumberEnc: next },
  });
  return count === 1;
}

/** FR-17: removes the details and the old masked text. */
export async function deletePayoutAccount(tx: Tx, shopId: string): Promise<void> {
  const client = writableClientOf(tx);
  await client.shopPayoutAccount.deleteMany({ where: { shopId } });
  await client.shop.updateMany({ where: { id: shopId }, data: { payoutAccountMasked: null } });
}
