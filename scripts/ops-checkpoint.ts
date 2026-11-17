import { z } from "zod";
import { disconnectAppClient } from "@/lib/server/db/tx";
import { recordCheckpoint } from "@/lib/server/services/ops";

// B14 (OPS-07): records how the nightly backup went, for the admin Operations card and the overdue/failed alert
// (OPS-06). The backup timer runs it after the backup container exits (docs/runbook.md, "Backups"):
//   node dist/ops-checkpoint.mjs backup ok|failed
// Connects as ceyliving_app like the worker.

const args = z.tuple([z.literal("backup"), z.enum(["ok", "failed"])]);

async function main() {
  const parsed = args.safeParse(process.argv.slice(2));
  if (!parsed.success) {
    console.error("Usage: ops-checkpoint backup ok|failed");
    process.exitCode = 2;
    return;
  }
  const [name, outcome] = parsed.data;
  await recordCheckpoint(name, outcome);
  console.log(JSON.stringify({ checkpoint: name, outcome }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Recording the checkpoint failed.");
    process.exitCode = 1;
  })
  .finally(disconnectAppClient);
