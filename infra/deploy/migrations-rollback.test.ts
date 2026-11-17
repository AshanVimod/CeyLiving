import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// B14 (17.3 step 4): a deploy migrates first and, if the new version isn't ready, starts the previous version again
// on the migrated database; a rollback does the same later. That is only safe while migrations expand (DB-11): add
// tables, columns, indexes and constraints the old code already satisfies. Removing or renaming something is a
// "contract" step, shipped only once no running version uses it, and its migration says so with a line
// `-- DB-11 contract: <what no longer uses it>` (docs/runbook.md, "Migrations and rollback").

const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

/** Statements the previous version of the app may not survive. */
const BREAKING = [
  /\bDROP\s+(TABLE|COLUMN|TYPE|SCHEMA|VIEW|FUNCTION)\b/i,
  /\bRENAME\b/i,
  /\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i,
  /\bSET\s+NOT\s+NULL\b/i,
];

/** SQL without comments, so the "down" notes each migration keeps in comments don't count. */
const code = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

export function breakingStatements(sql: string): string[] {
  if (/^\s*--\s*DB-11 contract:/im.test(sql)) return [];
  return code(sql)
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter((statement) => BREAKING.some((pattern) => pattern.test(statement)));
}

describe("migrations and rollback", () => {
  it("DB-11 every migration only expands, so the previous version still runs after a deploy or rollback", () => {
    const found = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const sql = readFileSync(path.join(MIGRATIONS, entry.name, "migration.sql"), "utf8");
        return breakingStatements(sql).map((statement) => `${entry.name}: ${statement}`);
      });
    expect(found).toEqual([]);
  });

  it("DB-11 the check catches a drop or rename, and accepts a marked contract step", () => {
    expect(breakingStatements('ALTER TABLE "orders" DROP COLUMN "note";')).toHaveLength(1);
    expect(breakingStatements('ALTER TABLE "shops" RENAME COLUMN "a" TO "b";')).toHaveLength(1);
    expect(breakingStatements('ALTER TABLE "x" ALTER COLUMN "y" SET NOT NULL;')).toHaveLength(1);
    expect(breakingStatements('ALTER TABLE "x" ALTER COLUMN "y" TYPE bigint;')).toHaveLength(1);
    expect(breakingStatements("-- down: DROP TABLE refunds;\nCREATE TABLE refunds (id text);")).toEqual([]);
    expect(breakingStatements('ALTER TABLE "x" ALTER COLUMN "y" DROP NOT NULL;')).toEqual([]);
    expect(
      breakingStatements('-- DB-11 contract: no release since 2026-12 reads it\nALTER TABLE "x" DROP COLUMN "y";'),
    ).toEqual([]);
  });
});
