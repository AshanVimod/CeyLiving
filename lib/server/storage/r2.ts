import "server-only";
import { AwsClient, AwsV4Signer } from "aws4fetch";
import type { Env } from "@/lib/env";
import {
  assertKey,
  isPrivateKey,
  ORIGINAL_KEY,
  PRESIGN_SECONDS,
  PRIVATE_PHOTO_KEY,
  PUBLIC_KEY,
  readAtMost,
  StorageError,
  type Storage,
} from "./storage";

// B09 (backend plan 11.1): Cloudflare R2 through its S3 API, signed with aws4fetch (SigV4, no other dependencies).
// Two buckets: R2_UPLOAD_BUCKET is private (originals, application photos); R2_PUBLIC_BUCKET is served at
// NEXT_PUBLIC_IMAGE_BASE_URL through R2's custom domain. Errors name the status and the operation, never the keys.

/** A slow storage call fails rather than holding a request or a job (A10). */
const TIMEOUT_MS = 15_000;
const YEAR_SECONDS = 31_536_000;

export function r2Storage(env: Env): Storage {
  const accountId = env.R2_ACCOUNT_ID!;
  const credentials = { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! };
  // aws4fetch retries 5xx answers itself; two tries are enough, the job retries the rest (JOB-04).
  const client = new AwsClient({ ...credentials, service: "s3", region: "auto", retries: 2 });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const url = (bucket: string, key: string) =>
    `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const privateUrl = (key: string) => url(env.R2_UPLOAD_BUCKET!, key);
  const publicUrl = (key: string) => url(env.R2_PUBLIC_BUCKET!, key);

  async function call(what: string, target: string, init: RequestInit, ok: (status: number) => boolean) {
    let response: Response;
    try {
      response = await client.fetch(target, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new StorageError(`R2 ${what} failed: ${error instanceof Error ? error.name : "network error"}`);
    }
    if (!ok(response.status)) {
      await response.body?.cancel();
      throw new StorageError(`R2 ${what} answered ${response.status}`, response.status);
    }
    return response;
  }

  const put = (what: string, target: string, body: Uint8Array, contentType: string, cacheControl: string) =>
    call(
      what,
      target,
      // A copy typed as fetch wants it (the copies are a few hundred KB at most).
      {
        method: "PUT",
        body: Uint8Array.from(body),
        headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
      },
      (s) => s === 200,
    ).then((r) => r.body?.cancel());

  const del = (what: string, target: string) =>
    call(what, target, { method: "DELETE" }, (s) => s === 204 || s === 200 || s === 404).then((r) => r.body?.cancel());

  return {
    driver: "r2",
    async presignPut(key, { contentType, sizeBytes }) {
      assertKey(key, ORIGINAL_KEY);
      // SEC-07: the signature covers the type and the exact length, so R2 refuses any other file.
      const signed = await new AwsV4Signer({
        ...credentials,
        method: "PUT",
        url: `${privateUrl(key)}?X-Amz-Expires=${PRESIGN_SECONDS}`,
        headers: { "Content-Type": contentType, "Content-Length": String(sizeBytes) },
        service: "s3",
        region: "auto",
        signQuery: true,
        allHeaders: true,
      }).sign();
      // The browser sets Content-Length itself from the file; it only needs to send the type.
      return { url: signed.url.toString(), headers: { "Content-Type": contentType } };
    },
    async headPrivate(key) {
      assertKey(key, ORIGINAL_KEY);
      const response = await call("head", privateUrl(key), { method: "HEAD" }, (s) => s === 200 || s === 404);
      if (response.status === 404) return null;
      return { sizeBytes: Number(response.headers.get("content-length") ?? 0) };
    },
    async getPrivate(key, maxBytes) {
      assertKey(key, isPrivateKey);
      const response = await call("get", privateUrl(key), { method: "GET" }, (s) => s === 200 || s === 404);
      if (response.status === 404) return { kind: "missing" };
      if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
        await response.body?.cancel();
        return { kind: "too-large" };
      }
      // Counted while reading as well, in case the length header is missing.
      const bytes = await readAtMost(response.body, maxBytes);
      return bytes ? { kind: "ok", bytes } : { kind: "too-large" };
    },
    async putPrivate(key, body, contentType) {
      assertKey(key, PRIVATE_PHOTO_KEY);
      await put("put private", privateUrl(key), body, contentType, "private, no-store");
    },
    async deletePrivate(key) {
      assertKey(key, isPrivateKey);
      await del("delete private", privateUrl(key));
    },
    async putPublic(key, body, contentType) {
      assertKey(key, PUBLIC_KEY);
      // The file at a key never changes (a new photo gets a new upload id), so browsers and Cloudflare keep it.
      await put("put public", publicUrl(key), body, contentType, `public, max-age=${YEAR_SECONDS}, immutable`);
    },
    async deletePublic(key) {
      assertKey(key, PUBLIC_KEY);
      await del("delete public", publicUrl(key));
    },
  };
}
