// @vitest-environment node
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { hashPassword } from "better-auth/crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/session";
import { TURNSTILE_TEST_KEYS } from "@/lib/env";
import { endRequest, jar, SESSION_COOKIE, signInAs, signOutLocally, startRequest, testIp } from "@/test/auth";
import { readAll, user, withTestDatabase } from "@/test/db";
import { emailCapture } from "@/test/email";

// B05b: two-step sign-in, passkey rules, Turnstile and admin session limits, against the test database with real
// Better Auth sessions. Cloudflare and the breached-password service are stubbed: nothing leaves the machine.

vi.mock("next/headers", async () => (await import("@/test/auth")).nextHeaders);
vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect:${to}`), { to, digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
  notFound: () => {
    throw new Error("notFound");
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("redirect:")) throw error;
  },
}));
// B10: sign-in emails are queued; mail() delivers them the way the worker does, into `sent`.
const { sent, mail } = emailCapture();

const { forgotPasswordAction, registerAction, signInAction } = await import("./actions/auth");
const { confirmAppSetupAction, newRecoveryCodesAction, startAppSetupAction, turnOffAppAction, verifyTwoStepAction } =
  await import("./actions/two-step");
const { requireRole } = await import("./auth");
const { getAuth } = await import("./better-auth");
const { createPrismaClient } = await import("./db/tx");

withTestDatabase();

const GOOD = "lacquer-and-loom-42";
/** The only token the Turnstile stub accepts. */
const HUMAN = "token-from-a-person";
const siteverify = vi.hoisted(() => ({ calls: [] as URLSearchParams[] }));

beforeEach(() => {
  sent.length = 0;
  siteverify.calls.length = 0;
  signOutLocally();
  testIp.value = "203.0.113.20";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      // The app's forms send a form body; Better Auth's captcha plugin sends JSON.
      const raw = String(init?.body);
      const body = new URLSearchParams(raw.startsWith("{") ? (JSON.parse(raw) as Record<string, string>) : raw);
      siteverify.calls.push(body);
      return Response.json(
        body.get("response") === HUMAN ? { success: true } : { success: false, "error-codes": ["invalid-input"] },
      );
    }
    // Breached-password check: nothing is ever reported as leaked here.
    if (url.startsWith("https://api.pwnedpasswords.com/range/")) return new Response("");
    throw new Error(`Unexpected network call in a test: ${url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  return fd;
};
const caught = async (promise: Promise<unknown>) => promise.then(() => undefined).catch((e: Error) => e);
const ctx = () => getAuth().$context;

/** Gives a seeded account a password (accounts made before B05a have none). */
async function givePassword(userId: string) {
  await (
    await ctx()
  ).internalAdapter.linkAccount({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await hashPassword(GOOD),
  });
}

/** The current 6-digit code for a key as the set-up page shows it (base32, in groups of four). */
async function codeFor(key: string) {
  const secret = new TextDecoder().decode(base32.decode(key.replace(/\s/g, "")));
  return createOTP(secret).totp();
}

/** Sets up an authenticator app for whoever is signed in; returns the key and the recovery codes. */
async function setUpApp(password?: string) {
  const started = await startAppSetupAction(null, form(password ? { password } : {}));
  if (!("setup" in started) || !started.setup) throw new Error(`set-up didn't start: ${JSON.stringify(started)}`);
  const confirmed = await confirmAppSetupAction(null, form({ code: await codeFor(started.setup.key) }));
  expect(confirmed).toMatchObject({ ok: true });
  return started.setup;
}

async function sessionsOf(userId: string) {
  return (await ctx()).internalAdapter.listSessions(userId);
}

describe("AU-02 sellers and admins need two-step before /seller and /admin", () => {
  it("a seller signed in with a password only is sent to set it up, then back", async () => {
    await signInAs("user_seller", { twoStep: false });
    const err = await caught(requireRole(["SELLER"], "/seller/orders"));
    expect(err?.message).toBe("redirect:/account/two-step?next=%2Fseller%2Forders");
    expect((await getSession())?.user).toMatchObject({ id: "user_seller", needsTwoStep: true });
  });

  it("an admin signed in with a password only is sent to set it up too", async () => {
    await signInAs("user_admin", { twoStep: false });
    expect((await caught(requireRole(["ADMIN"], "/admin")))?.message).toBe("redirect:/account/two-step?next=%2Fadmin");
  });

  it("calling seller and admin actions directly is refused the same way, and nothing changes", async () => {
    const before = await readAll();
    const product = before.products.find((p) => p.status === "PENDING_REVIEW") ?? before.products[0]!;
    const sellerOrder = before.sellerOrders.find((so) => so.status === "NEW")!;

    await signInAs("user_seller", { twoStep: false });
    const selling = await import("./actions/selling");
    const order = await selling.transitionOrderAction(null, form({ sellerOrderId: sellerOrder.id, to: "ACCEPTED" }));
    expect(order).toMatchObject({ ok: false, message: expect.stringContaining("Set up two-step sign-in first") });

    signOutLocally();
    await signInAs("user_admin", { twoStep: false });
    const admin = await import("./actions/admin");
    const decided = await admin.decideProductAction(null, form({ decision: "approve", productId: product.id }));
    expect(decided).toMatchObject({ ok: false, message: expect.stringContaining("Set up two-step sign-in first") });

    const after = await readAll();
    expect(after.sellerOrders.find((so) => so.id === sellerOrder.id)?.status).toBe("NEW");
    expect(after.products.find((p) => p.id === product.id)?.status).toBe(product.status);
  });

  it("customers are never asked; a seller session opened with two steps goes straight in", async () => {
    await signInAs("user_customer", { twoStep: false });
    expect((await getSession())?.user.needsTwoStep).toBeUndefined();
    signOutLocally();
    await signInAs("user_seller", { twoStep: true });
    expect((await requireRole(["SELLER"], "/seller")).id).toBe("user_seller");
  });
});

describe("AU-02 / AU-04 authenticator app (TOTP)", () => {
  it("set-up shows a QR code and the key; the first code turns it on and ends every other session", async () => {
    await givePassword("user_seller");
    const otherDevice = await signInAs("user_seller", { twoStep: false });
    signOutLocally();
    await signInAs("user_seller", { twoStep: false });

    expect(await startAppSetupAction(null, form({ password: "not-my-password" }))).toMatchObject({
      ok: false,
      fieldErrors: { password: expect.any(String) },
    });
    const started = await startAppSetupAction(null, form({ password: GOOD }));
    if (!("setup" in started) || !started.setup) throw new Error("no set-up");
    expect(started.setup.qrCode).toMatch(/^data:image\/svg\+xml;utf8,/);
    expect(started.setup.key).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
    expect(started.setup.recoveryCodes).toHaveLength(10);

    // Not on until a code from the app is confirmed.
    expect((await readAll()).users.find((u) => u.id === "user_seller")).toBeDefined();
    expect(await confirmAppSetupAction(null, form({ code: "000000" }))).toMatchObject({ ok: false });
    expect(await confirmAppSetupAction(null, form({ code: await codeFor(started.setup.key) }))).toMatchObject({
      ok: true,
    });

    const tokens = (await sessionsOf("user_seller")).map((s) => s.token);
    expect(tokens).not.toContain(otherDevice.token); // AU-04: the other device is signed out
    expect(tokens).toHaveLength(1); // this browser got a fresh session (rotated) ...
    expect((await requireRole(["SELLER"], "/seller")).id).toBe("user_seller"); // ... that counts as two-step
  });

  it("after the code, the page re-rendered in the same request still sees the person signed in", async () => {
    // Regression (found in the browser): Better Auth swaps the session cookie inside the action; the re-render that
    // follows has the old cookie in headers() and only the new one in cookies(). The recovery codes must still show.
    await givePassword("user_seller");
    await signInAs("user_seller", { twoStep: false });
    const started = await startAppSetupAction(null, form({ password: GOOD }));
    if (!("setup" in started) || !started.setup) throw new Error("no set-up");
    startRequest();
    try {
      expect(await confirmAppSetupAction(null, form({ code: await codeFor(started.setup.key) }))).toMatchObject({
        ok: true,
      });
      const after = await getSession();
      expect(after?.user).toMatchObject({ id: "user_seller" });
      expect(after?.user.needsTwoStep).toBeUndefined();
    } finally {
      endRequest();
    }
  });

  it("signing in with the password then asks for a code, and only the code starts the session", async () => {
    await givePassword("user_seller");
    await signInAs("user_seller", { twoStep: false });
    const { key } = await setUpApp(GOOD);
    signOutLocally();

    const email = user("user_seller").email;
    const step1 = await caught(signInAction(null, form({ email, password: GOOD, next: "/seller/orders" })));
    expect(step1?.message).toBe("redirect:/signin/two-step?next=%2Fseller%2Forders");
    expect(jar.has(SESSION_COOKIE)).toBe(false); // no session after the password alone
    expect(await getSession()).toBeNull();

    expect(
      await verifyTwoStepAction(null, form({ method: "app", code: "123456", next: "/seller/orders" })),
    ).toMatchObject({ ok: false, fieldErrors: { code: expect.any(String) } });
    const step2 = await caught(
      verifyTwoStepAction(null, form({ method: "app", code: await codeFor(key), next: "/seller/orders" })),
    );
    expect(step2?.message).toBe("redirect:/seller/orders");
    expect((await getSession())?.user).toMatchObject({ id: "user_seller" });
    expect((await getSession())?.user.needsTwoStep).toBeUndefined();
  });

  it("a code can't be sent without signing in with the password first", async () => {
    const result = await verifyTwoStepAction(null, form({ method: "app", code: "123456" }));
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Sign in again") });
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("sellers and admins can't turn it off; customers can, with their password", async () => {
    await givePassword("user_seller");
    await signInAs("user_seller", { twoStep: false });
    await setUpApp(GOOD);
    expect(await turnOffAppAction(null, form({ password: GOOD }))).toMatchObject({ ok: false });
    // Not through Better Auth's own route either.
    const cookie = `${SESSION_COOKIE}=${jar.get(SESSION_COOKIE)}`;
    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/two-factor/disable", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
        body: JSON.stringify({ password: GOOD }),
      }),
    );
    expect(response.status).toBe(403);

    signOutLocally();
    await givePassword("user_customer");
    await signInAs("user_customer", { twoStep: false });
    await setUpApp(GOOD);
    expect(await turnOffAppAction(null, form({ password: GOOD }))).toMatchObject({ ok: true });
  });
});

describe("AU-02 recovery codes", () => {
  async function signInWithPasswordOnly() {
    signOutLocally();
    const err = await caught(signInAction(null, form({ email: user("user_seller").email, password: GOOD })));
    expect(err?.message).toBe("redirect:/signin/two-step?next=%2Faccount");
  }

  it("are stored only as hashes and each works once", async () => {
    await givePassword("user_seller");
    await signInAs("user_seller", { twoStep: false });
    const { recoveryCodes } = await setUpApp(GOOD);

    const stored = await createPrismaClient(process.env.DATABASE_URL!).twoFactor.findUniqueOrThrow({
      where: { userId: "user_seller" },
    });
    for (const code of recoveryCodes) {
      expect(stored.backupCodes).not.toContain(code);
      expect(stored.backupCodes).not.toContain(code.replace("-", ""));
    }
    const hashes = JSON.parse(stored.backupCodes) as string[];
    expect(hashes).toHaveLength(10);
    hashes.forEach((h) => expect(h).toMatch(/^rc1:[0-9a-f]{64}$/));

    // A stored hash typed in as if it were a code doesn't work.
    await signInWithPasswordOnly();
    expect(await verifyTwoStepAction(null, form({ method: "recovery", code: hashes[0]! }))).toMatchObject({
      ok: false,
    });

    const code = recoveryCodes[0]!;
    await signInWithPasswordOnly();
    expect((await caught(verifyTwoStepAction(null, form({ method: "recovery", code }))))?.message).toBe(
      "redirect:/account",
    );
    expect((await getSession())?.user.needsTwoStep).toBeUndefined(); // a recovery code counts as two steps

    await signInWithPasswordOnly();
    expect(await verifyTwoStepAction(null, form({ method: "recovery", code }))).toMatchObject({
      ok: false,
      fieldErrors: { code: expect.any(String) },
    });
    expect(await getSession()).toBeNull();
    // A different, unused code still works.
    expect(
      (await caught(verifyTwoStepAction(null, form({ method: "recovery", code: recoveryCodes[1]! }))))?.message,
    ).toBe("redirect:/account");
  });

  it("new codes replace the old ones, which stop working", async () => {
    await givePassword("user_seller");
    await signInAs("user_seller", { twoStep: false });
    const { recoveryCodes: old } = await setUpApp(GOOD);
    const fresh = await newRecoveryCodesAction(null, form({ password: GOOD }));
    if (!("recoveryCodes" in fresh) || !fresh.recoveryCodes) throw new Error("no new codes");
    expect(fresh.recoveryCodes).toHaveLength(10);

    await signInWithPasswordOnly();
    expect(await verifyTwoStepAction(null, form({ method: "recovery", code: old[0]! }))).toMatchObject({ ok: false });
    expect(
      (await caught(verifyTwoStepAction(null, form({ method: "recovery", code: fresh.recoveryCodes[0]! }))))?.message,
    ).toBe("redirect:/account");
  });
});

describe("AU-06 Turnstile, checked on the server", () => {
  const register = (email: string, token?: string) =>
    registerAction(
      null,
      form({ name: "Nimali Silva", email, password: GOOD, ...(token ? { "cf-turnstile-response": token } : {}) }),
    );

  it("sign-up is refused without a valid token: no account, no email", async () => {
    for (const token of [undefined, "forged-token"]) {
      expect(await register("robot@example.lk", token)).toMatchObject({
        ok: false,
        fieldErrors: { turnstile: expect.any(String) },
      });
    }
    expect((await readAll()).users.some((u) => u.email === "robot@example.lk")).toBe(false);
    expect(await mail()).toHaveLength(0);
    // The token was checked with Cloudflare, using the server's secret and the visitor's IP.
    expect(siteverify.calls).toHaveLength(1);
    expect(Object.fromEntries(siteverify.calls[0]!)).toEqual({
      secret: TURNSTILE_TEST_KEYS.secretKey,
      response: "forged-token",
      remoteip: "203.0.113.20",
    });

    expect(await register("person@example.lk", HUMAN)).toMatchObject({ ok: true });
    expect((await mail()).map((e) => e.to)).toEqual(["person@example.lk"]);
  });

  it("a password reset request is refused without a valid token", async () => {
    const email = user("user_customer").email;
    expect(await forgotPasswordAction(null, form({ email }))).toMatchObject({ ok: false });
    expect(await mail()).toHaveLength(0);
    expect(await forgotPasswordAction(null, form({ email, "cf-turnstile-response": HUMAN }))).toMatchObject({
      ok: true,
    });
    expect(await mail()).toHaveLength(1);
  });

  it("if Cloudflare can't be reached, the check fails closed", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await register("offline@example.lk", HUMAN)).toMatchObject({ ok: false });
    expect((await readAll()).users.some((u) => u.email === "offline@example.lk")).toBe(false);
  });

  it("sign-in needs no token at first, then one after 3 failed attempts, even with the right password", async () => {
    await givePassword("user_customer");
    const email = user("user_customer").email;
    const wrong = (i: number) => signInAction(null, form({ email, password: `wrong-password-${i}` }));
    expect(await wrong(1)).toEqual({ ok: false, message: expect.stringContaining("don’t match") });
    expect(await wrong(2)).toEqual({ ok: false, message: expect.stringContaining("don’t match") });
    // The third failure tells the form to show the check.
    expect(await wrong(3)).toMatchObject({ ok: false, fieldErrors: { turnstile: expect.any(String) } });
    expect(siteverify.calls).toHaveLength(0);

    const noToken = await signInAction(null, form({ email, password: GOOD }));
    expect(noToken).toMatchObject({ ok: false, fieldErrors: { turnstile: expect.any(String) } });
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    const withToken = await caught(signInAction(null, form({ email, password: GOOD, "cf-turnstile-response": HUMAN })));
    expect(withToken?.message).toBe("redirect:/account");
    expect((await getSession())?.user.id).toBe("user_customer");
  });

  it("failures from one IP across many emails also bring the check in", async () => {
    testIp.value = "198.51.100.77";
    for (let i = 0; i < 3; i++) {
      await signInAction(null, form({ email: `nobody${i}@example.lk`, password: "wrong-password" }));
    }
    const next = await signInAction(null, form({ email: "someone-else@example.lk", password: "wrong-password" }));
    expect(next).toMatchObject({ ok: false, fieldErrors: { turnstile: expect.any(String) } });
  });

  it("Better Auth's own sign-in routes, called directly, need a valid token too", async () => {
    await givePassword("user_customer");
    const post = (path: string, body: object, token?: string) =>
      getAuth().handler(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3000",
            ...(token ? { "x-captcha-response": token } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const email = user("user_customer").email;
    expect((await post("/sign-in/email", { email, password: GOOD })).status).toBe(400);
    expect((await post("/sign-in/email", { email, password: GOOD }, "forged-token")).status).toBe(403);
    expect((await post("/sign-up/email", { name: "Bot", email: "bot@example.lk", password: GOOD })).status).toBe(400);
    expect((await post("/request-password-reset", { email })).status).toBe(400);
    expect(await mail()).toHaveLength(0);
    expect((await post("/sign-in/email", { email, password: GOOD }, HUMAN)).status).toBe(200);
  });
});

describe("AU-03 admin sessions: 12 hours in all, 2 hours idle", () => {
  const HOUR = 60 * 60 * 1000;
  async function age(sessionId: string, fields: { createdAt?: Date; updatedAt?: Date }) {
    await (
      await ctx()
    ).adapter.update({ model: "session", where: [{ field: "id", value: sessionId }], update: fields });
  }

  it("an admin session ends 12 hours after sign-in, even while in use", async () => {
    const session = await signInAs("user_admin");
    await age(session.id, { createdAt: new Date(Date.now() - 11 * HOUR), updatedAt: new Date() });
    expect((await getSession())?.user.id).toBe("user_admin");
    await age(session.id, { createdAt: new Date(Date.now() - 12 * HOUR - 60_000), updatedAt: new Date() });
    expect(await getSession()).toBeNull();
    expect((await sessionsOf("user_admin")).map((s) => s.id)).not.toContain(session.id);
  });

  it("an admin session ends after 2 hours without use", async () => {
    const session = await signInAs("user_admin");
    await age(session.id, { updatedAt: new Date(Date.now() - 1.5 * HOUR) });
    expect((await getSession())?.user.id).toBe("user_admin"); // used within 2 hours: still fine, and extended
    await age(session.id, { updatedAt: new Date(Date.now() - 2 * HOUR - 60_000) });
    expect(await getSession()).toBeNull();
    expect((await sessionsOf("user_admin")).map((s) => s.id)).not.toContain(session.id);
  });

  it("other people keep the normal limits (7 days idle, 30 days in all)", async () => {
    const session = await signInAs("user_seller");
    await age(session.id, { createdAt: new Date(Date.now() - 13 * HOUR), updatedAt: new Date(Date.now() - 3 * HOUR) });
    expect((await getSession())?.user.id).toBe("user_seller");
  });

  it("using the session records the use, at most every 15 minutes", async () => {
    const session = await signInAs("user_admin");
    const c = await ctx();
    const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000);
    await age(session.id, { updatedAt: halfHourAgo });
    await c.adapter.update({
      model: "session",
      where: [{ field: "id", value: session.id }],
      update: { expiresAt: new Date(halfHourAgo.getTime() + 7 * 24 * HOUR) },
    });
    await getSession();
    const [row] = (await sessionsOf("user_admin")).filter((s) => s.id === session.id);
    expect(row!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
