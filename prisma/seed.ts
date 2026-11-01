import { loadStoreData } from "@/lib/server/db/load-seed";
import { createPrismaClient } from "@/lib/server/db/tx";
import { buildSeed } from "./seed-data";

// `npm run db:seed` (and `prisma migrate reset`, see prisma.config.ts): replaces every row in the local database
// with the demo data. It runs as the schema owner, because emptying tables needs it, and refuses production.

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is not set: run `npm run setup` or see .env.example.");
  const client = createPrismaClient(url);
  try {
    await loadStoreData(client, buildSeed(new Date()), { replace: true });
    console.log("Loaded the demo data: 5 demo accounts, 10 shops and their items, orders, reviews and questions.");
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
