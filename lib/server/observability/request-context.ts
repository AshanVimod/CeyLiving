import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { clientIp, ipHash, UNKNOWN_IP } from "../security/ip";

/**
 * OPS-02: what the current request is, for code deep inside a service that has no headers (the audit log, Sentry).
 * Set by runAction and withRoute; empty in the worker and in scripts, where there is no request.
 */
export interface RequestContext {
  requestId: string;
  /** The visitor's IP as its keyed hash (lib/server/security/ip.ts), or undefined when no proxy header named it. */
  ipHash?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context for a request with these headers and this ID. An unknown IP has no hash (nothing to link). */
export function requestContextFrom(requestHeaders: Headers, requestId: string): RequestContext {
  const ip = clientIp(requestHeaders);
  return { requestId, ipHash: ip === UNKNOWN_IP ? undefined : ipHash(ip) };
}

export function withRequestContext<T>(context: RequestContext, body: () => T): T {
  return storage.run(context, body);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
