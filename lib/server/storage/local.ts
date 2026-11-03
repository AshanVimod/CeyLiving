import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "@/lib/env";
import {
  assertKey,
  isPrivateKey,
  readAtMost,
  ORIGINAL_KEY,
  PRESIGN_SECONDS,
  PRIVATE_PHOTO_KEY,
  PUBLIC_KEY,
  type Storage,
} from "./storage";

// B09 (backend plan 11.1, 15.1): files on this computer under .data/uploads/, so no cloud account is needed for
// development and tests. Presigned uploads go to the dev-only route app/api/uploads/local (an HMAC stands in for
// R2's signature); public photos are served by app/dev-uploads. Production refuses this driver (lib/env.ts).

/** Development only; production never uses this driver. */
const DEV_SIGNING_KEY = "ceyliving-dev-only-local-upload-signing-key";

export const LOCAL_UPLOAD_ROUTE = "/api/uploads/local";

// The turbopackIgnore comments keep these runtime paths out of the build's file tracing: the local driver is for
// development and tests only, and production never reads this folder.
export function localRoot(env: Env): string {
  return path.resolve(/*turbopackIgnore: true*/ env.LOCAL_UPLOADS_DIR ?? path.join(process.cwd(), ".data", "uploads"));
}

/** The file for `key` inside `area`, refusing anything that would land outside it. */
export function localPath(env: Env, area: "private" | "public", key: string): string {
  const base = path.join(/*turbopackIgnore: true*/ localRoot(env), area);
  const file = path.resolve(base, ...key.split("/"));
  if (!file.startsWith(base + path.sep)) throw new Error("Refused a path outside the uploads folder.");
  return file;
}

interface LocalTicket {
  key: string;
  contentType: string;
  sizeBytes: number;
  /** Seconds since 1970. */
  expires: number;
}

function signature(env: Env, t: LocalTicket): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET ?? DEV_SIGNING_KEY)
    .update(`${t.key}\n${t.contentType}\n${t.sizeBytes}\n${t.expires}`)
    .digest("base64url");
}

/** The upload route's check: the ticket was made here, is unexpired and names an original's key. */
export function verifyLocalTicket(env: Env, params: URLSearchParams, now = Date.now()): LocalTicket | undefined {
  const ticket = {
    key: params.get("key") ?? "",
    contentType: params.get("type") ?? "",
    sizeBytes: Number(params.get("size")),
    expires: Number(params.get("exp")),
  };
  if (!ORIGINAL_KEY.test(ticket.key) || !Number.isInteger(ticket.sizeBytes) || !Number.isInteger(ticket.expires))
    return undefined;
  if (ticket.expires * 1000 < now) return undefined;
  const given = Buffer.from(params.get("sig") ?? "");
  const expected = Buffer.from(signature(env, ticket));
  return given.length === expected.length && timingSafeEqual(given, expected) ? ticket : undefined;
}

/** The local driver is for development and tests only (lib/env.ts refuses it in production as well). */
export function isLocalDriverOn(env: Env): boolean {
  return env.STORAGE_DRIVER === "local" && env.NODE_ENV !== "production";
}

/**
 * The dev upload route's work: stores the body under the ticket's key if it has exactly the ticket's type and size
 * (what R2's signature enforces in production). Returns the HTTP status to answer with.
 */
export async function receiveLocalUpload(env: Env, request: Request, now = Date.now()): Promise<number> {
  const ticket = verifyLocalTicket(env, new URL(request.url).searchParams, now);
  if (!ticket) return 403;
  if (request.headers.get("content-type") !== ticket.contentType) return 403;
  if (Number(request.headers.get("content-length")) !== ticket.sizeBytes) return 403;
  const body = await readAtMost(request.body, ticket.sizeBytes);
  if (!body) return 413;
  if (body.byteLength !== ticket.sizeBytes) return 400;
  await write(localPath(env, "private", ticket.key), body);
  return 200;
}

/** A public file for the dev image route, or null. */
export async function readLocalPublic(env: Env, key: string): Promise<Buffer | null> {
  if (!PUBLIC_KEY.test(key)) return null;
  return readFile(localPath(env, "public", key)).catch(() => null);
}

async function write(file: string, body: Uint8Array) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

async function remove(file: string) {
  await rm(file, { force: true });
}

export function localStorage(env: Env): Storage {
  return {
    driver: "local",
    async presignPut(key, { contentType, sizeBytes }) {
      assertKey(key, ORIGINAL_KEY);
      const ticket = { key, contentType, sizeBytes, expires: Math.floor(Date.now() / 1000) + PRESIGN_SECONDS };
      const query = new URLSearchParams({
        key,
        type: contentType,
        size: String(sizeBytes),
        exp: String(ticket.expires),
        sig: signature(env, ticket),
      });
      return { url: `${LOCAL_UPLOAD_ROUTE}?${query}`, headers: { "Content-Type": contentType } };
    },
    async headPrivate(key) {
      assertKey(key, ORIGINAL_KEY);
      const info = await stat(localPath(env, "private", key)).catch(() => null);
      return info?.isFile() ? { sizeBytes: info.size } : null;
    },
    async getPrivate(key, maxBytes) {
      assertKey(key, isPrivateKey);
      const file = localPath(env, "private", key);
      const handle = await open(file, "r").catch(() => null);
      if (!handle) return { kind: "missing" };
      try {
        if ((await handle.stat()).size > maxBytes) return { kind: "too-large" };
        return { kind: "ok", bytes: await readFile(handle) };
      } finally {
        await handle.close();
      }
    },
    async putPrivate(key, body) {
      assertKey(key, PRIVATE_PHOTO_KEY);
      await write(localPath(env, "private", key), body);
    },
    async deletePrivate(key) {
      assertKey(key, isPrivateKey);
      await remove(localPath(env, "private", key));
    },
    async putPublic(key, body) {
      assertKey(key, PUBLIC_KEY);
      await write(localPath(env, "public", key), body);
    },
    async deletePublic(key) {
      assertKey(key, PUBLIC_KEY);
      await remove(localPath(env, "public", key));
    },
  };
}
