// npm run setup (backend plan 15.2): from a clean clone to a working site in one command.
// Checks Node, creates .env.local, starts PostgreSQL and Mailpit in Docker, applies the migrations and loads the
// demo data. Safe to run again: it keeps an existing .env.local and replaces only the local demo data.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = (command) => execSync(command, { cwd: root, stdio: "inherit" });
const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

// 1. Node version (.nvmrc)
const wanted = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const actual = process.versions.node.split(".")[0];
if (actual !== wanted) fail(`Node ${wanted} is required (see .nvmrc); this is Node ${process.versions.node}.`);
console.log(`Node ${process.versions.node}: OK`);

// 2. .env.local, with the local database addresses filled in. Their passwords exist only in the local Docker
// database (infra/docker-compose.dev.yml) and are never used anywhere else.
const LOCAL_VALUES = {
  DATABASE_URL: "postgresql://ceyliving_app:ceyliving_dev_app@localhost:15432/ceyliving",
  DATABASE_MIGRATION_URL: "postgresql://ceyliving_migrator:ceyliving_dev_migrator@localhost:15432/ceyliving",
  // B05a: sign-in emails go to Mailpit, and a random local secret signs session cookies.
  SMTP_URL: "smtp://127.0.0.1:1025",
  BETTER_AUTH_SECRET: crypto.randomBytes(32).toString("base64url"),
};
const local = path.join(root, ".env.local");
if (fs.existsSync(local)) {
  console.log(".env.local already exists: left unchanged.");
} else {
  let text = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  for (const [key, value] of Object.entries(LOCAL_VALUES)) text = text.replace(`# ${key}=`, `${key}=${value}`);
  fs.writeFileSync(local, text);
  console.log("Created .env.local from .env.example: local database, Mailpit for emails, a local secret.");
}
// AU-09: demo sign-in goes in .env.development.local, which Next.js reads only for `next dev`. A production build,
// even on this computer, never sees it (and lib/env.ts refuses it in production anyway).
const devOnly = path.join(root, ".env.development.local");
if (!fs.existsSync(devOnly)) {
  fs.writeFileSync(
    devOnly,
    "# Development only (read by `next dev`, never by production builds).\nENABLE_DEMO_LOGIN=true\n",
  );
  console.log("Created .env.development.local: demo sign-in on /signin while developing.");
}
process.loadEnvFile(local);

// 3. PostgreSQL and Mailpit in Docker
try {
  execSync("docker info", { stdio: "ignore" });
} catch {
  fail("Docker is not running. Start Docker Desktop, then run `npm run setup` again.");
}
console.log("\nStarting PostgreSQL and Mailpit…");
run("docker compose -f infra/docker-compose.dev.yml up -d --wait");

// 4. Migrations, as the schema owner (DB-10)
console.log("\nApplying migrations…");
run("npx prisma migrate deploy");

// 5. Demo data
console.log("\nLoading the demo data…");
run("npm run db:seed");

console.log("\nReady. Next: npm run dev, then open http://localhost:3000 and pick a demo account on /signin.");
console.log("Emails the app sends land in Mailpit: http://localhost:8025.");
