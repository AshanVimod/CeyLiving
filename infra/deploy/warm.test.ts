import { describe, expect, it } from "vitest";
import { sitemapUrls, warm } from "./warm.mjs";

// B14 (17.3): the post-deploy warm-up requests every sitemap address inside the web container.

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://ceyliving.lk</loc></url>
<url><loc>https://ceyliving.lk/shop</loc></url>
<url><loc>https://ceyliving.lk/p/naga-raksha-mask</loc><lastmod>2026-11-01</lastmod></url>
<url><loc>https://ceyliving.lk/search?q=a&amp;b=c</loc></url>
<url><loc>https://ceyliving.lk/shop</loc></url>
</urlset>`;

describe("warm-up", () => {
  it("17.3 requests every sitemap address once, on the internal origin", async () => {
    expect(sitemapUrls(SITEMAP, "http://127.0.0.1:3000")).toEqual([
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000/shop",
      "http://127.0.0.1:3000/p/naga-raksha-mask",
      "http://127.0.0.1:3000/search?q=a&b=c",
    ]);
    const requested: string[] = [];
    const send = async (url: RequestInfo | URL) => {
      requested.push(String(url));
      return new Response(String(url).endsWith("sitemap.xml") ? SITEMAP : "<html></html>");
    };
    const summary = await warm({ origin: "http://127.0.0.1:3000", send });
    expect(summary).toMatchObject({ total: 4, ok: 4, failed: [] });
    expect(requested[0]).toBe("http://127.0.0.1:3000/sitemap.xml");
    expect(requested.every((u) => u.startsWith("http://127.0.0.1:3000/"))).toBe(true);
  });

  it("17.3 reports failed pages without stopping, and fails only when the sitemap can't be read", async () => {
    const send = async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.endsWith("sitemap.xml")) return new Response(SITEMAP);
      if (s.includes("/p/")) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      if (s.endsWith("/shop")) return new Response("", { status: 500 });
      return new Response("ok");
    };
    const summary = await warm({ origin: "http://127.0.0.1:3000", send });
    expect(summary).toMatchObject({ total: 4, ok: 2 });
    expect(summary.failed).toEqual(expect.arrayContaining(["/shop 500", "/p/naga-raksha-mask TimeoutError"]));

    const down = async () => new Response("", { status: 503 });
    await expect(warm({ origin: "http://127.0.0.1:3000", send: down })).rejects.toThrow("sitemap.xml answered 503");
  });
});
