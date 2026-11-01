import fs from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 reads the connection here, not from schema.prisma. Migrations run as the schema owner (DB-10), so the CLI
// uses DATABASE_MIGRATION_URL; the app itself connects with DATABASE_URL as ceyliving_app (lib/server/db/prisma.ts).
// `prisma generate` needs no database, so the URL may be missing then. The CLI reads .env.local like the app does.
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
});
