// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_ENCRYPTION_DEV_KEY } from "@/lib/env";
import {
  decryptField,
  encryptField,
  FieldEncryptionError,
  isCurrentKey,
  keyIdOf,
  rotateField,
} from "./field-encryption";

afterEach(() => vi.unstubAllEnvs());

const NUMBER = "7391058246";
const CONTEXT = "shop_payout_accounts.account_number:shop_a";
/** Generated, so no key text is in the source for a secret scanner to mistake for a real one. */
const OTHER_KEY = Buffer.alloc(32, "another-test-key").toString("base64");

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FieldEncryptionError);
    return (error as FieldEncryptionError).code;
  }
  throw new Error("expected a FieldEncryptionError");
}

describe("12.4 field encryption", () => {
  it("12.4 a value decrypts to itself under the same context", () => {
    expect(decryptField(encryptField(NUMBER, CONTEXT), CONTEXT)).toBe(NUMBER);
  });

  it("12.4 encrypting one value twice gives different results", () => {
    expect(encryptField(NUMBER, CONTEXT)).not.toBe(encryptField(NUMBER, CONTEXT));
  });

  it("12.4 the stored value carries the key id and not the plain value", () => {
    const stored = encryptField(NUMBER, CONTEXT);
    expect(stored).toMatch(/^v1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(keyIdOf(stored)).toBe(stored.split(".")[1]);
    expect(stored).not.toContain(NUMBER);
    expect(Buffer.from(stored.split(".")[3]!, "base64url").toString("latin1")).not.toContain(NUMBER);
  });

  it("12.4 changing any part of the stored value fails safely", () => {
    const stored = encryptField(NUMBER, CONTEXT);
    const parts = stored.split(".");
    const flip = (part: string) => (part[0] === "A" ? `B${part.slice(1)}` : `A${part.slice(1)}`);
    expect(codeOf(() => decryptField([parts[0], parts[1], flip(parts[2]!), parts[3]].join("."), CONTEXT))).toBe(
      "DECRYPT_FAILED",
    );
    expect(codeOf(() => decryptField([parts[0], parts[1], parts[2], flip(parts[3]!)].join("."), CONTEXT))).toBe(
      "DECRYPT_FAILED",
    );
    expect(codeOf(() => decryptField([parts[0], "0".repeat(16), parts[2], parts[3]].join("."), CONTEXT))).toBe(
      "UNKNOWN_KEY",
    );
    for (const broken of [
      NUMBER,
      "",
      `v2.${parts.slice(1).join(".")}`,
      parts.slice(0, 3).join("."),
      `${stored}.extra`,
      [parts[0], parts[1], "short", parts[3]].join("."),
      [parts[0], parts[1], parts[2], "abc"].join("."),
      [parts[0], parts[1], parts[2], `${parts[3]}!`].join("."),
    ]) {
      expect(codeOf(() => decryptField(broken, CONTEXT))).toBe("BAD_ENVELOPE");
    }
  });

  it("12.4 a wrong key fails safely, with nothing sensitive in the error", () => {
    const stored = encryptField(NUMBER, CONTEXT);
    vi.stubEnv("FIELD_ENCRYPTION_KEY", OTHER_KEY);
    let caught: unknown;
    try {
      decryptField(stored, CONTEXT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FieldEncryptionError);
    expect((caught as FieldEncryptionError).code).toBe("UNKNOWN_KEY");
    const shown = JSON.stringify({ ...(caught as object), m: String(caught), s: (caught as Error).stack });
    for (const secret of [NUMBER, stored, OTHER_KEY, FIELD_ENCRYPTION_DEV_KEY]) expect(shown).not.toContain(secret);
  });

  it("12.4 a value moved to another shop does not decrypt", () => {
    const stored = encryptField(NUMBER, CONTEXT);
    expect(codeOf(() => decryptField(stored, "shop_payout_accounts.account_number:shop_b"))).toBe("DECRYPT_FAILED");
  });

  it("12.4 after rotation the old key still decrypts and new values use the new key", () => {
    const old = encryptField(NUMBER, CONTEXT);
    expect(isCurrentKey(old)).toBe(true);
    vi.stubEnv("FIELD_ENCRYPTION_KEY", OTHER_KEY);
    vi.stubEnv("FIELD_ENCRYPTION_PREVIOUS_KEYS", FIELD_ENCRYPTION_DEV_KEY);
    expect(decryptField(old, CONTEXT)).toBe(NUMBER);
    expect(isCurrentKey(old)).toBe(false);
    const rotated = rotateField(old, CONTEXT);
    expect(isCurrentKey(rotated)).toBe(true);
    expect(keyIdOf(rotated)).not.toBe(keyIdOf(old));
    expect(decryptField(rotated, CONTEXT)).toBe(NUMBER);
    vi.stubEnv("FIELD_ENCRYPTION_PREVIOUS_KEYS", "");
    expect(decryptField(rotated, CONTEXT)).toBe(NUMBER);
    expect(codeOf(() => decryptField(old, CONTEXT))).toBe("UNKNOWN_KEY");
  });
});
