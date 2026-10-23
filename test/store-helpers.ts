import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach } from "vitest";
import { resetStoreForTests } from "@/lib/server/store/dev-store";
import { findUserById } from "@/lib/server/repositories/people";
import type { User } from "@/lib/types";

/** Gives the calling test file its own throwaway store, reseeded before every test. */
export function withTestStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ceyliving-test-"));
  beforeEach(() => {
    process.env.CEYLIVING_STORE_PATH = path.join(dir, "store.json");
    resetStoreForTests();
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
}

export function user(id: string): User {
  const found = findUserById(id);
  if (!found) throw new Error(`Seed user ${id} missing`);
  return found;
}
