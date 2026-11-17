// B14 (17.3): the post-deploy warm-up. A new version starts with an empty cache and an item page takes ~400 ms to
// render the first time (B13), so after a deploy every address in /sitemap.xml is requested once, two at a time,
// from inside the web container. Failures are reported, not fatal: the site is already serving.
//   node /app/ops/warm.mjs [http://127.0.0.1:3000]
// Plain Node (no dependencies), so it runs in the image as it is.
import { pathToFileURL } from "node:url";

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The sitemap's addresses, moved to `origin` (the public site's origin is swapped for the internal one). */
export function sitemapUrls(xml, origin) {
  const urls = new Set();
  for (const [, loc] of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    let url;
    try {
      url = new URL(decode(loc));
    } catch {
      continue;
    }
    urls.add(new URL(url.pathname + url.search, origin).href);
  }
  return [...urls];
}

/** Requests every sitemap address. Returns counts and the failed paths (at most 20). */
export async function warm({ origin, send = fetch, concurrency = 2, timeoutMs = 30_000, now = Date.now }) {
  const started = now();
  const sitemap = await send(new URL("/sitemap.xml", origin), { signal: AbortSignal.timeout(timeoutMs) });
  if (!sitemap.ok) throw new Error(`sitemap.xml answered ${sitemap.status}`);
  const urls = sitemapUrls(await sitemap.text(), origin);
  const failed = [];
  let next = 0;
  async function lane() {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const response = await send(url, { signal: AbortSignal.timeout(timeoutMs) });
        await response.arrayBuffer(); // read the whole page, so the render (and its cache write) completes
        if (!response.ok) failed.push(`${new URL(url).pathname} ${response.status}`);
      } catch (error) {
        failed.push(`${new URL(url).pathname} ${error instanceof Error ? error.name : "error"}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, lane));
  return { total: urls.length, ok: urls.length - failed.length, failed: failed.slice(0, 20), ms: now() - started };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] ?? "http://127.0.0.1:3000";
  warm({ origin }).then(
    (summary) => console.log(JSON.stringify({ msg: "deploy.warm", ...summary })),
    (error) => {
      console.error(JSON.stringify({ msg: "deploy.warm_failed", error: String(error?.message ?? error) }));
      process.exitCode = 1;
    },
  );
}
