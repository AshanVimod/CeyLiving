// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs, signOutLocally, testIp } from "@/test/auth";
import { migratorClient, user, withTestDatabase } from "@/test/db";

// B12 (backend plan 12.2, 12.4, OPS-02): state-changing routes need our own Origin and stay under their body limit;
// audit rows carry the request ID and the IP's keyed hash; no raw IP is stored anywhere we write.

vi.mock("next/headers", async () => (await import("@/test/auth")).nextHeaders);
vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect:${to}`), { to, digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("redirect:")) throw error;
  },
}));

const { withRoute, DEFAULT_BODY_LIMIT_BYTES } = await import("@/lib/server/observability/route");
const { runAction } = await import("@/lib/server/run-action");
const { withTx, db } = await import("@/lib/server/db/tx");
const { audit, WORKER } = await import("@/lib/server/services/shared");
const { listAuditLog } = await import("@/lib/server/repositories/people");
const { ipHash } = await import("./ip");
const { isAllowedOrigin } = await import("./origin");
const { getEnv } = await import("@/lib/env");
const { settleEventCounts } = await import("@/lib/server/services/ops");
const { signInAction } = await import("@/lib/server/actions/auth");

withTestDatabase();

const SITE = "http://localhost:3000";

beforeEach(async () => {
  signOutLocally();
  testIp.value = "203.0.113.10";
  await migratorClient().$executeRawUnsafe("DELETE FROM ops_event_counts");
  // Turnstile (needed after 3 failed sign-ins) and the breached-password check are stubbed: nothing leaves the machine.
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return Response.json({ success: true });
    if (url.startsWith("https://api.pwnedpasswords.com/range/")) return new Response("");
    return real(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

function post(url: string, init: { origin?: string | null; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", ...init.headers };
  if (init.origin !== null) headers.origin = init.origin ?? SITE;
  return new NextRequest(`${SITE}${url}`, { method: "POST", headers, body: init.body, duplex: "half" } as never);
}

/** A body streamed without Content-Length, as a client that lies about (or leaves out) the length would send it. */
function streamed(bytes: number): ReadableStream<Uint8Array> {
  let left = bytes;
  return new ReadableStream({
    pull(controller) {
      if (left <= 0) return controller.close();
      const n = Math.min(left, 64 * 1024);
      left -= n;
      controller.enqueue(new Uint8Array(n));
    },
  });
}

const eventCount = async (kind: string) =>
  (await settleEventCounts(),
  await migratorClient().opsEventCount.aggregate({ where: { kind }, _sum: { count: true } }))._sum.count ?? 0;

describe("12.2 Origin checks on state-changing routes", () => {
  const handler = vi.fn(async () => new Response(null, { status: 204 }));
  const POST = withRoute("api.test", handler);

  beforeEach(() => handler.mockClear());

  it("12.2 a mutating route refuses a wrong or missing Origin", async () => {
    for (const origin of ["https://evil.example", null, "null", "http://localhost:3000.evil.example"]) {
      const response = await POST(post("/api/test", { origin }));
      expect(response.status, String(origin)).toBe(403);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(await eventCount("origin_rejected")).toBe(4);
  });

  it("12.2 our own Origin passes; outside production so does the request's own host", async () => {
    expect((await POST(post("/api/test"))).status).toBe(204);
    const dev = post("/api/test", { origin: "http://localhost:3001", headers: { host: "localhost:3001" } });
    expect((await POST(dev)).status).toBe(204);
    // Production accepts SITE_URL's origin only, not whatever host the request names.
    const production = { ...getEnv(), NODE_ENV: "production" as const, SITE_URL: "https://ceyliving.lk" };
    const headers = (origin: string, host: string) => new Headers({ origin, host });
    expect(isAllowedOrigin(headers("https://ceyliving.lk", "ceyliving.lk"), "https://ceyliving.lk/x", production)).toBe(
      true,
    );
    expect(isAllowedOrigin(headers("https://evil.example", "evil.example"), "https://evil.example/x", production)).toBe(
      false,
    );
    expect(
      isAllowedOrigin(headers("http://localhost:3001", "localhost:3001"), "http://localhost:3001/x", production),
    ).toBe(false);
  });

  it("12.2 a GET needs no Origin", async () => {
    const GET = withRoute("api.test", handler);
    expect((await GET(new NextRequest(`${SITE}/api/test`))).status).toBe(204);
  });

  it("12.2 the PayHere and internal routes need no Origin", async () => {
    const payhere = await import("@/app/api/payments/payhere/notify/route");
    expect((await payhere.POST(post("/api/payments/payhere/notify", { origin: null }))).status).toBe(200);
    const refresh = await import("@/app/api/internal/catalogue-refresh/route");
    // No secret: the route's own plain 404, not withRoute's 403.
    expect((await refresh.POST(post("/api/internal/catalogue-refresh", { origin: null }))).status).toBe(404);
  });

  it("12.2 every mutating route handler goes through withRoute", () => {
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routes.push(full);
      }
    };
    walk(path.join(process.cwd(), "app"));
    expect(routes.length).toBeGreaterThan(5);
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      for (const [, method, rest] of source.matchAll(
        /export\s+(?:const|async function|function)\s+(POST|PUT|PATCH|DELETE)\b(.*)/g,
      )) {
        expect(rest, `${path.relative(process.cwd(), file)} ${method}`).toMatch(/^\s*=\s*withRoute\(/);
      }
    }
  });
});

describe("12.2 request body limits", () => {
  const POST = withRoute("api.test", async (request) =>
    Response.json({ size: (await request.arrayBuffer()).byteLength }),
  );

  it("12.2 a body over the limit gets 413, with or without Content-Length", async () => {
    const big = new Uint8Array(DEFAULT_BODY_LIMIT_BYTES + 1);
    expect((await POST(post("/api/test", { body: big }))).status).toBe(413);
    const lying = post("/api/test", {
      body: streamed(DEFAULT_BODY_LIMIT_BYTES + 1),
      headers: { "content-length": "10" },
    });
    expect((await POST(lying)).status).toBe(413);
    expect((await POST(post("/api/test", { body: streamed(3 * DEFAULT_BODY_LIMIT_BYTES) }))).status).toBe(413);
    expect(await eventCount("body_too_large")).toBe(3);
  });

  it("12.2 a body at the limit is accepted, and the handler reads all of it", async () => {
    const response = await POST(post("/api/test", { body: streamed(DEFAULT_BODY_LIMIT_BYTES) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ size: DEFAULT_BODY_LIMIT_BYTES });
  });

  it("12.2 PayHere's route has a 64 KB limit", async () => {
    const payhere = await import("@/app/api/payments/payhere/notify/route");
    const response = await payhere.POST(
      post("/api/payments/payhere/notify", { origin: null, body: new Uint8Array(65 * 1024) }),
    );
    expect(response.status).toBe(413);
  });
});

describe("12.2 Better Auth's routes, now wrapped", () => {
  it("12.2 sign-in through /api/auth still works with our Origin, and is refused without it", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const body = JSON.stringify({ email: "nobody@example.lk", password: "zzzzzzzzzzzz" });
    const json = { "content-type": "application/json", "x-captcha-response": "stub-accepted-token" };
    const signIn = await POST(post("/api/auth/sign-in/email", { body, headers: json }));
    expect(signIn.status).toBe(401); // Better Auth's own answer: wrong details
    // A passkey sign-in: the options (a GET, no Origin needed), then the browser's POST of its answer.
    const { GET } = await import("@/app/api/auth/[...all]/route");
    const options = await GET(new NextRequest(`${SITE}/api/auth/passkey/generate-authenticate-options`));
    expect(options.status).toBe(200);
    expect(await options.json()).toHaveProperty("challenge");
    const answer = JSON.stringify({ response: { id: "not-a-real-passkey", response: {} } });
    const verify = await POST(post("/api/auth/passkey/verify-authentication", { body: answer, headers: json }));
    expect([403, 413]).not.toContain(verify.status); // reaches Better Auth, which refuses the made-up passkey
    expect(verify.status).toBeGreaterThanOrEqual(400);
    const foreign = await POST(
      post("/api/auth/sign-in/email", { origin: "https://evil.example", body, headers: json }),
    );
    expect(foreign.status).toBe(403);
  });
});

describe("OPS-02 / 12.4 audit rows and IPs", () => {
  it("OPS-02 an audit row carries the request ID and IP hash", async () => {
    await runAction(async () => {
      await withTx((tx) => audit(tx, user("user_admin"), "test.audited", "USER", "user_customer"));
    });
    const [row] = await migratorClient().auditLogEntry.findMany({ where: { action: "test.audited" } });
    expect(row!.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row!.ipHash).toBe(ipHash("203.0.113.10"));
    expect(row!.ipHash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("OPS-02 a worker's audit row leaves both empty", async () => {
    await withTx((tx) => audit(tx, WORKER, "test.by_worker", "ORDER", "ord_x", { reason: "test job" }));
    const [row] = await migratorClient().auditLogEntry.findMany({ where: { action: "test.by_worker" } });
    expect(row).toMatchObject({ requestId: null, ipHash: null });
  });

  it("OPS-02 audit rows written before B12 (no ip_hash or request_id) still load and display", async () => {
    await migratorClient().$executeRawUnsafe(
      `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, reason, created_at)
       VALUES ('audit_before_b12', 'user_admin', 'shop.suspended', 'SHOP', 'shop_x', 'Before B12', now())`,
    );
    const entry = (await listAuditLog(db)).find((e) => e.id === "audit_before_b12");
    expect(entry).toMatchObject({ action: "shop.suspended", reason: "Before B12" });
    expect(entry!.requestId).toBeUndefined();
    expect(entry!.ipHash).toBeUndefined();
  });

  it("12.4 an unknown IP gives no hash, and the database refuses anything but a hash", async () => {
    await expect(
      migratorClient().$executeRawUnsafe(
        `INSERT INTO audit_log (id, action, target_type, target_id, created_at, ip_hash)
         VALUES ('audit_raw_ip', 'x', 'USER', 'u', now(), '203.0.113.10')`,
      ),
    ).rejects.toThrow(/audit_log_ip_hash/);
  });

  it("12.4 no raw IP in audit_log, rate_limits or sessions after sign-ins", async () => {
    const form = new FormData();
    form.append("email", "target@example.lk");
    form.append("password", "zzzzzzzzzzzz");
    form.append("cf-turnstile-response", "stub-accepted-token");
    await signInAction(null, form); // a failed sign-in: counted per email and per IP
    // A real sign-in through Better Auth, from the test IP: the session row it makes must not keep the IP.
    const { getAuth } = await import("@/lib/server/better-auth");
    const context = await getAuth().$context;
    const customer = user("user_customer");
    await context.internalAdapter.linkAccount({
      userId: customer.id,
      providerId: "credential",
      accountId: customer.id,
      password: await hashPassword("xxxxxxxxxxxx"),
    });
    await getAuth().api.signInEmail({
      body: { email: customer.email, password: "xxxxxxxxxxxx" },
      headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    });
    await signInAs("user_seller"); // and one made directly through the adapter
    await runAction(async () => {
      await withTx((tx) => audit(tx, user("user_admin"), "test.audited", "USER", "user_customer"));
    });
    const c = migratorClient();
    const text = JSON.stringify([
      await c.auditLogEntry.findMany(),
      await c.rateLimit.findMany({ select: { key: true } }),
      await c.session.findMany({ select: { ipAddress: true } }),
    ]);
    expect(text).not.toContain("203.0.113.10");
    expect((await c.session.findMany()).every((s) => s.ipAddress === null)).toBe(true);
    const keys = (await c.rateLimit.findMany()).map((r) => r.key);
    expect(keys).toContain(`ceyliving:sign-in:ip:${ipHash("203.0.113.10")}`);
  });

  it("AU-06 sign-in limits still apply with hashed keys: 5 per IP, and another IP has its own count", async () => {
    const attempt = async (email: string) => {
      const form = new FormData();
      form.append("email", email);
      form.append("password", "zzzzzzzzzzzz");
      form.append("cf-turnstile-response", "stub-accepted-token");
      return signInAction(null, form);
    };
    for (let i = 0; i < 5; i++) expect((await attempt(`spray${i}@example.lk`)).message).toMatch(/don’t match/);
    expect((await attempt("spray9@example.lk")).message).toBe("Too many attempts. Wait 15 minutes, then try again.");
    testIp.value = "198.51.100.7";
    expect((await attempt("spray10@example.lk")).message).toMatch(/don’t match/);
    expect(await eventCount("auth_rate_limited")).toBe(1);
    expect(await eventCount("sign_in_failed")).toBe(6);
  });
});
