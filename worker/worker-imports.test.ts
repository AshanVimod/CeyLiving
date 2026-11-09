// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// B11 (12.4): the worker doesn't hold the encryption key, so it mustn't be able to reach the code that uses it. Walks
// the worker's real imports from its entry file. `import type` lines disappear at run time and are skipped.

const ROOT = resolve(__dirname, "..");
const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveModule(from: string, spec: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return undefined;
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const next = resolveModule(file, match[1] ?? match[2]!);
      if (next) queue.push(next);
    }
  }
  return new Set([...seen].map((file) => relative(ROOT, file).replaceAll("\\", "/")));
}

describe("B11 the worker and the encryption key", () => {
  const files = reachableFrom(join(ROOT, "worker/index.ts"));

  it("12.4 the walk really follows the worker's imports", () => {
    expect(files).toContain("lib/server/services/payouts.ts");
    expect(files).toContain("lib/server/repositories/payout-accounts.ts");
  });

  it("12.4 the worker can't reach the code that encrypts, decrypts or reveals", () => {
    expect(files).not.toContain("lib/server/crypto/field-encryption.ts");
    expect(files).not.toContain("lib/server/services/payout-accounts.ts");
  });

  it("12.4 only the reveal and the re-encrypt run call the functions that load encrypted numbers", () => {
    const calls = /\b(findStoredPayoutAccount|storedPayoutAccountsAfter)\(/;
    for (const file of files) {
      if (file === "lib/server/repositories/payout-accounts.ts" || !/\.tsx?$/.test(file)) continue;
      expect(calls.test(readFileSync(join(ROOT, file), "utf8")), file).toBe(false);
    }
  });
});
