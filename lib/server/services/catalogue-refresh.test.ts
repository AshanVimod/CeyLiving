import { describe, expect, it } from "vitest";
import { parseEnv, type Env } from "@/lib/env";
import { captureLogger } from "@/test/log-capture";
import { expireBuildCatalogue, startWarmPaths } from "./catalogue-refresh";

// B14: a starting web app expires the catalogue pages prerendered at build time (BE-09), so it never serves the
// build database's items. No database needed: the route call is replaced by a fake fetch.

const SECRET = "test-cache-refresh-secret-0123456789abcdef";
const production = (extra: Record<string, string> = {}): Env => ({
  ...parseEnv({ NODE_ENV: "test", CACHE_REFRESH_SECRET: SECRET, ...extra }),
  NODE_ENV: "production",
});

/** A clock the fake sleep moves forward, so retries take no real time. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("expireBuildCatalogue", () => {
  it("BE-09 the web app expires the build-time catalogue on its own address when it starts, then loads the lists", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let n = 0;
    const send = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      n += 1;
      if (n < 3) throw Object.assign(new Error("connect ECONNREFUSED"), { name: "TypeError" });
      if (url.endsWith("/makers")) return new Response("", { status: 500 });
      return new Response(url.endsWith("catalogue-refresh") ? null : "<html></html>", {
        status: url.endsWith("catalogue-refresh") ? 204 : 200,
      });
    }) as typeof fetch;
    const { logger, lines } = captureLogger();
    const result = await expireBuildCatalogue(logger, { env: production(), port: "3000", send, ...fakeClock() });
    expect(result).toBe("refreshed");
    expect(calls).toHaveLength(3 + startWarmPaths().length);
    expect(calls[0]!.url).toBe("http://127.0.0.1:3000/api/internal/catalogue-refresh");
    expect(calls[0]!.init).toMatchObject({ method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
    // Then every list page once, on this process, after the expiry (the sitemap first: the deploy warm-up reads it).
    const pages = calls.slice(3).map((c) => c.url);
    expect(pages).toEqual(startWarmPaths().map((path) => `http://127.0.0.1:3000${path}`));
    expect(pages).toEqual(expect.arrayContaining(["http://127.0.0.1:3000/", "http://127.0.0.1:3000/shop"]));
    expect(startWarmPaths()[0]).toBe("/sitemap.xml");
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "catalogue.start_refresh",
        attempts: 3,
        warmed: startWarmPaths().length - 1,
        warmFailed: ["/makers 500"],
      }),
    );
  });

  it("BE-09 gives up after the deadline so the process can exit and be restarted, without logging the secret", async () => {
    const send = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const { logger, lines } = captureLogger();
    const result = await expireBuildCatalogue(logger, { env: production(), send, deadlineMs: 5_000, ...fakeClock() });
    expect(result).toBe("failed");
    expect(lines).toContainEqual(
      expect.objectContaining({ msg: "catalogue.start_refresh_failed", last: "answered 404" }),
    );
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });

  it("BE-09 does nothing outside production or without the secret", async () => {
    const send = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const { logger } = captureLogger();
    expect(
      await expireBuildCatalogue(logger, { env: parseEnv({ NODE_ENV: "test", CACHE_REFRESH_SECRET: SECRET }), send }),
    ).toBe("skipped");
    const noSecret: Env = { ...parseEnv({ NODE_ENV: "test" }), NODE_ENV: "production" };
    expect(await expireBuildCatalogue(logger, { env: noSecret, send })).toBe("skipped");
  });
});
