// B13 (backend plan 14): load test for the catalogue, item and shop pages, and the signed-in checkout page.
// Target: p95 under 300 ms at the given arrival rate on the target data size (1,000 items).
//
// Run it with the pinned k6 image (no k6 install needed), against a production build (`next build && next start`):
//   BASE_URL=http://host.docker.internal:3000 npm run load:k6
// Optional:
//   RATE=10           requests a second for the browsing scenario (default 10)
//   DURATION=2m       how long each scenario runs (default 2m)
//   SESSION_COOKIE    a signed-in session cookie ("ceyliving.session_token=…"), which adds the checkout scenario
//                     (the checkout page and the cart lookup, 1 a second). It places no orders: placing one needs
//                     the build's server-action id and creates real orders and stock holds.
// Read-only: no request changes data. Point it at a local or staging copy, never at production.
// Start on a warm cache: request every address in /sitemap.xml once (twice is safer) after the server starts or the
// whole catalogue was refreshed. A cold item page renders in about 400 ms, so a cold run measures first renders.

import http from "k6/http";
import { check } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://host.docker.internal:3000").replace(/\/$/, "");
const RATE = Number(__ENV.RATE || 10);
const DURATION = __ENV.DURATION || "2m";
const SESSION_COOKIE = __ENV.SESSION_COOKIE || "";

const scenarios = {
  browse: {
    executor: "constant-arrival-rate",
    exec: "browse",
    rate: RATE,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: Math.max(10, RATE * 2),
    maxVUs: Math.max(50, RATE * 5),
  },
};
if (SESSION_COOKIE) {
  scenarios.checkout = {
    executor: "constant-arrival-rate",
    exec: "checkout",
    rate: 1,
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 5,
    maxVUs: 20,
  };
}

export const options = {
  scenarios,
  thresholds: {
    "http_req_duration{kind:catalogue}": ["p(95)<300"],
    "http_req_duration{kind:item}": ["p(95)<300"],
    "http_req_duration{kind:shop}": ["p(95)<300"],
    ...(SESSION_COOKIE ? { "http_req_duration{kind:checkout}": ["p(95)<300"] } : {}),
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};

/** Item and shop addresses from the sitemap, so the test spreads over the whole catalogue. */
export function setup() {
  const sitemap = http.get(`${BASE_URL}/sitemap.xml`, { tags: { kind: "setup" } });
  if (sitemap.status !== 200) throw new Error(`sitemap.xml answered ${sitemap.status}; is BASE_URL right?`);
  // The path of each address (k6 has no URL global).
  const paths = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/^https?:\/\/[^/]+/, ""));
  const items = paths.filter((p) => p.startsWith("/p/"));
  const shops = paths.filter((p) => p.startsWith("/shop/"));
  const categories = paths.filter((p) => p.startsWith("/c/"));
  if (!items.length || !shops.length) throw new Error("The sitemap lists no items or shops.");
  return { items, shops, categories: categories.length ? categories : ["/search"] };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const WORDS = ["mask", "batik", "clay", "brass", "wood", "lamp", "shirt", "basket"];
const SORTS = ["featured", "newest", "price_asc", "rating"];

/** One visitor request, weighted roughly like real browsing: item pages most, then lists, then the rest. */
export function browse(data) {
  const roll = Math.random();
  let path;
  let kind;
  if (roll < 0.35) [path, kind] = [pick(data.items), "item"];
  else if (roll < 0.5) [path, kind] = [pick(data.categories), "catalogue"];
  else if (roll < 0.62) [path, kind] = [`/search?q=${pick(WORDS)}`, "catalogue"];
  else if (roll < 0.7) [path, kind] = [`/search?sort=${pick(SORTS)}`, "catalogue"];
  else if (roll < 0.8) [path, kind] = ["/", "catalogue"];
  else if (roll < 0.9) [path, kind] = [pick(data.shops), "shop"];
  else if (roll < 0.95) [path, kind] = ["/makers", "catalogue"];
  else [path, kind] = [`/api/catalogue?q=${pick(WORDS).slice(0, 3)}`, "catalogue"];
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { kind, name: kind === "item" || kind === "shop" ? kind : path },
  });
  check(res, { "status 200": (r) => r.status === 200 });
}

/** A signed-in customer opening checkout, and the cart asking for its items' current details. */
export function checkout(data) {
  const params = { headers: { cookie: SESSION_COOKIE }, redirects: 0, tags: { kind: "checkout" } };
  const page = http.get(`${BASE_URL}/checkout`, { ...params, tags: { kind: "checkout", name: "/checkout" } });
  check(page, { "checkout page 200 (signed in)": (r) => r.status === 200 });
  const slugs = [pick(data.items), pick(data.items)].map((p) => p.replace("/p/", "")).join(",");
  const cart = http.get(`${BASE_URL}/api/catalogue?slugs=${slugs}`, {
    ...params,
    tags: { kind: "checkout", name: "/api/catalogue?slugs" },
  });
  check(cart, { "cart lookup 200": (r) => r.status === 200 });
}
