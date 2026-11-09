/** B11: what a shop's encrypted account number is bound to; a value copied onto another shop doesn't decrypt. */
export function payoutAccountContext(shopId: string): string {
  return `shop_payout_accounts.account_number:${shopId}`;
}
