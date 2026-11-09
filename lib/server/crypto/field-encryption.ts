import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { fieldEncryptionKeys } from "@/lib/env";

// B11 (backend plan 12.4): AES-256-GCM for single database fields, with Node's own crypto. A stored value is
//   v1.<key id>.<iv>.<ciphertext + tag>     (the last two in base64url)
// The key id is derived from the key, so a key can't be given another key's label. The context names where the value
// belongs (table, column, row) and is authenticated with it: a value copied onto another row doesn't decrypt.

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type FieldEncryptionErrorCode = "UNKNOWN_KEY" | "BAD_ENVELOPE" | "DECRYPT_FAILED";

/** Says what went wrong and nothing else: never the value, the stored text or a key. */
export class FieldEncryptionError extends Error {
  constructor(readonly code: FieldEncryptionErrorCode) {
    super(`Field encryption failed: ${code}`);
    this.name = "FieldEncryptionError";
  }
}

interface Key {
  id: string;
  bytes: Buffer;
}

function toKey(base64: string): Key {
  const bytes = Buffer.from(base64, "base64");
  return { id: createHash("sha256").update("ceyliving-field-key-id:").update(bytes).digest("hex").slice(0, 16), bytes };
}

function loadKeys(): { current: Key; all: Map<string, Key> } {
  const { current, previous } = fieldEncryptionKeys();
  const keys = [current, ...previous].map(toKey);
  return { current: keys[0]!, all: new Map(keys.map((key) => [key.id, key])) };
}

const additionalData = (keyId: string, context: string) => Buffer.from(`${VERSION}.${keyId}.${context}`, "utf8");

/** Encrypts with the current key and a fresh random IV. */
export function encryptField(plain: string, context: string): string {
  const { current } = loadKeys();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, current.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(current.id, context));
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, current.id, iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

function decodePart(part: string): Buffer {
  const bytes = Buffer.from(part, "base64url");
  // Buffer.from skips what it can't read; a stored value must be exactly what encryptField wrote.
  if (bytes.toString("base64url") !== part) throw new FieldEncryptionError("BAD_ENVELOPE");
  return bytes;
}

function parse(envelope: string) {
  const parts = envelope.split(".");
  const [version, keyId, iv, sealed] = parts;
  if (parts.length !== 4 || version !== VERSION || !/^[0-9a-f]{16}$/.test(keyId ?? "")) {
    throw new FieldEncryptionError("BAD_ENVELOPE");
  }
  const ivBytes = decodePart(iv!);
  const sealedBytes = decodePart(sealed!);
  if (ivBytes.length !== IV_BYTES || sealedBytes.length < TAG_BYTES) throw new FieldEncryptionError("BAD_ENVELOPE");
  return { keyId: keyId!, iv: ivBytes, sealed: sealedBytes };
}

/** Decrypts with the current or a previous key. Throws FieldEncryptionError; there is no fallback value. */
export function decryptField(envelope: string, context: string): string {
  const { keyId, iv, sealed } = parse(envelope);
  const key = loadKeys().all.get(keyId);
  if (!key) throw new FieldEncryptionError("UNKNOWN_KEY");
  try {
    const decipher = createDecipheriv(ALGORITHM, key.bytes, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(key.id, context));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    const body = sealed.subarray(0, sealed.length - TAG_BYTES);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    throw new FieldEncryptionError("DECRYPT_FAILED");
  }
}

/** The id of the key a stored value was encrypted with. */
export function keyIdOf(envelope: string): string {
  return parse(envelope).keyId;
}

export function isCurrentKey(envelope: string): boolean {
  return keyIdOf(envelope) === loadKeys().current.id;
}

/** Key rotation: the same value, encrypted again with the current key. */
export function rotateField(envelope: string, context: string): string {
  return encryptField(decryptField(envelope, context), context);
}
