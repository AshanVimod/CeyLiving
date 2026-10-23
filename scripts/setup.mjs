// npm run setup (backend plan 15.2). B00 stub: checks Node and creates .env.local.
// Later tasks add Docker services, migrations and the seed here.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const wanted = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
const actual = process.versions.node.split(".")[0];

if (actual !== wanted) {
  console.error(`Node ${wanted} is required (see .nvmrc); this is Node ${process.versions.node}.`);
  process.exit(1);
}
console.log(`Node ${process.versions.node}: OK`);

const example = path.join(root, ".env.example");
const local = path.join(root, ".env.local");
if (fs.existsSync(local)) {
  console.log(".env.local already exists: left unchanged.");
} else {
  fs.copyFileSync(example, local);
  console.log("Created .env.local from .env.example. The defaults are safe for development.");
}

console.log("\nNext: npm run dev, then open http://localhost:3000.");
console.log("Docker services, migrations and the seed are added to this script in later backend tasks.");
