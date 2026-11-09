import { assertFieldEncryptionConfig } from "@/lib/env";
import { disconnectAppClient } from "@/lib/server/db/tx";
import { reencryptPayoutAccounts } from "@/lib/server/services/payout-accounts";

// B11 (12.4): `npm run payouts:reencrypt` moves every stored account number to the current FIELD_ENCRYPTION_KEY after
// a rotation. `npm run payouts:reencrypt -- --check` only reports which keys are in use and whether rows can be read.
// Safe to stop and run again. Prints counts only. Steps: README, "Bank details".

async function main() {
  assertFieldEncryptionConfig();
  const check = process.argv.includes("--check");
  const report = await reencryptPayoutAccounts({ check });
  console.log(JSON.stringify({ mode: check ? "check" : "reencrypt", ...report }));
  if (report.failed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "The re-encrypt run failed.");
    process.exitCode = 1;
  })
  .finally(disconnectAppClient);
