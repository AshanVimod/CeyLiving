// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/session";
import { jar, nextHeaders, SESSION_COOKIE, signInAs, signOutLocally, testIp } from "@/test/auth";
import type { OutgoingEmail } from "@/lib/server/email/drivers";
import { freshUser, migratorClient, readAll, user, withTestDatabase } from "@/test/db";
import { emailCapture, queuedDeliveries } from "@/test/email";

// B05a: real sign-in with Better Auth, against the test database. Emails are captured instead of sent, and the
// breached-password service and Cloudflare Turnstile are stubbed, so nothing leaves the machine. Forms carry a
// Turnstile token the stub accepts (B05b); lib/server/two-step.test.ts tests Turnstile itself.

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
// B10: sign-in emails are queued; mail() delivers them the way the worker does, into `sent`.
const { sent, mail } = emailCapture();

const { forgotPasswordAction, registerAction, resetPasswordAction, signInAction, changePasswordAction } =
  await import("./actions/auth");
const { signInAsDemo } = await import("./actions/session");
const { getAuth } = await import("./better-auth");
const { changeRole } = await import("./services/community-extras");
const { decideApplication } = await import("./services/applications");
const { deleteMyAccount } = await import("./services/privacy");
const { assertCanPost, canPost } = await import("./permissions");
const { countAuthAttempt } = await import("./repositories/people");
const { createPrismaClient, handlesFor, withTx } = await import("./db/tx");

withTestDatabase();

/** A password the stubbed breach service reports as leaked (AU-01). */
const BREACHED = "password12345";
const GOOD = "lacquer-and-loom-42";

beforeEach(() => {
  sent.length = 0;
  signOutLocally();
  testIp.value = "203.0.113.10";
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return Response.json({ success: true });
    if (!url.startsWith("https://api.pwnedpasswords.com/range/")) return real(input, init);
    const sha1 = createHash("sha1").update(BREACHED).digest("hex").toUpperCase();
    const prefix = url.slice(-5);
    return new Response(
      sha1.startsWith(prefix) ? `${sha1.slice(5)}:3861493\r\n` : "0018A45C4D1DEF81644B54AB7F969B88D65:1",
    );
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  fd.append("cf-turnstile-response", "stub-accepted-token"); // AU-06 (B05b)
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  return fd;
};

/** Opens an emailed link through Better Auth's own route, keeping any cookie it sets, as a browser would. */
async function openLink(url: string): Promise<Response> {
  const response = await getAuth().handler(
    new Request(url, { headers: await nextHeaders.headers(), redirect: "manual" }),
  );
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const [name, ...rest] = pair!.split("=");
    const value = rest.join("=");
    if (/max-age=0/i.test(cookie) || !value) jar.delete(name!);
    else jar.set(name!, value);
  }
  return response;
}

const linkIn = (email: OutgoingEmail) => email.text.match(/https?:\/\/\S+/)![0];
const caught = async (promise: Promise<unknown>) => promise.then(() => undefined).catch((e: Error) => e);

async function register(email: string, password = GOOD) {
  return registerAction(null, form({ name: "Nimali Silva", email, password, next: "/account" }));
}

describe("AU-01 / AU-07 sign up, confirm, sign in", () => {
  it("signs up, confirms the email through its link, and is signed in as a customer", async () => {
    const result = await register("Nimali@Example.LK");
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Check nimali@example.lk") });
    expect(await mail()).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "nimali@example.lk", subject: "Confirm your email for CeyLiving" });

    const created = (await readAll()).users.find((u) => u.email === "nimali@example.lk")!;
    expect(created).toMatchObject({ role: "CUSTOMER", emailVerified: false, postingRestriction: "NONE" });
    expect(created.id).toMatch(/^user_/);

    const response = await openLink(linkIn((await mail())[0]!));
    expect(response.status).toBe(302);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect((await getSession())?.user).toMatchObject({ id: created.id, emailVerified: true });
  });

  it("gives the same answer for an email that is already registered, and makes no second account", async () => {
    await register("twice@example.lk");
    const again = await register("twice@example.lk", "another-good-password");
    expect(again).toMatchObject({ ok: true, message: expect.stringContaining("Check twice@example.lk") });
    expect((await readAll()).users.filter((u) => u.email === "twice@example.lk")).toHaveLength(1);
  });

  it("AU-01 refuses a short password and one seen in a data breach", async () => {
    expect(await register("short@example.lk", "abc123")).toMatchObject({
      ok: false,
      fieldErrors: { password: "Use at least 10 characters." },
    });
    expect(await register("breached@example.lk", BREACHED)).toMatchObject({
      ok: false,
      fieldErrors: { password: expect.stringContaining("data breach") },
    });
    expect((await readAll()).users.some((u) => u.email.startsWith("breached@"))).toBe(false);
  });

  it("AU-08 a sign-up request can't choose its own role or restrictions", async () => {
    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ name: "Sneaky", email: "sneaky@example.lk", password: GOOD, role: "ADMIN" }),
      }),
    );
    const made = (await readAll()).users.find((u) => u.email === "sneaky@example.lk");
    expect(made?.role ?? "none").not.toBe("ADMIN");
    expect(response.status === 400 || made?.role === "CUSTOMER").toBe(true);
  });

  it("a confirmation link signs in once; opened again it confirms nothing new and signs no one in", async () => {
    await register("once@example.lk");
    const link = linkIn((await mail())[0]!);
    await openLink(link);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    signOutLocally();
    const sessionsBefore = (await readAll()).users.find((u) => u.email === "once@example.lk")!.id;
    const count = async () => (await (await getAuth().$context).internalAdapter.listSessions(sessionsBefore)).length;
    const before = await count();
    await openLink(link);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(await count()).toBe(before);
  });
});

describe("AU-01 an unconfirmed account can browse but not post or sell", () => {
  it("signing in unconfirmed sends a fresh link and starts no session; posting is refused", async () => {
    await register("unconfirmed@example.lk");
    await mail(); // the sign-up email
    sent.length = 0;
    const result = await signInAction(null, form({ email: "unconfirmed@example.lk", password: GOOD }));
    expect(result).toMatchObject({ ok: false, message: "Confirm your email first: we’ve sent you a new link." });
    expect(await mail()).toHaveLength(1);
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    const unconfirmed = (await readAll()).users.find((u) => u.email === "unconfirmed@example.lk")!;
    expect(canPost(unconfirmed)).toBe(false);
    expect(() => assertCanPost(unconfirmed)).toThrow("Confirm your email address first");
  });
});

describe("AU-07 sign-in never reveals whether an email has an account", () => {
  it("a wrong password and an unknown email get the same message", async () => {
    await register("known@example.lk");
    await openLink(linkIn((await mail())[0]!));
    signOutLocally();
    const wrong = await signInAction(null, form({ email: "known@example.lk", password: "not-the-password" }));
    const unknown = await signInAction(null, form({ email: "nobody@example.lk", password: "not-the-password" }));
    expect(wrong).toEqual(unknown);
    expect(wrong).toMatchObject({ ok: false, message: expect.stringContaining("don’t match an account") });
  });

  it("asking to reset an unknown email answers the same and sends nothing", async () => {
    const unknown = await forgotPasswordAction(null, form({ email: "nobody@example.lk" }));
    expect(await queuedDeliveries()).toEqual([]);
    const known = await forgotPasswordAction(null, form({ email: user("user_customer").email }));
    expect(unknown).toEqual(known);
    // B10: the request only queued the email (nothing was sent while it ran); the worker sends it.
    expect(sent).toEqual([]);
    expect((await queuedDeliveries()).map((d) => [d.template, d.userId])).toEqual([["auth.reset", "user_customer"]]);
    expect((await mail()).map((e) => e.to)).toEqual([user("user_customer").email]);
  });

  it("signs in with the right password and lands on the page it came from", async () => {
    await register("lands@example.lk");
    await openLink(linkIn((await mail())[0]!));
    signOutLocally();
    const err = await caught(
      signInAction(null, form({ email: "lands@example.lk", password: GOOD, next: "/account/orders" })),
    );
    expect(err?.message).toBe("redirect:/account/orders");
    expect((await getSession())?.user.email).toBe("lands@example.lk");
    const offSite = await caught(
      signInAction(null, form({ email: "lands@example.lk", password: GOOD, next: "//evil.example" })),
    );
    expect(offSite?.message).toBe("redirect:/account"); // SEC-A3: never off the site
  });
});

describe("AU-04 passwords and sessions", () => {
  it("an existing account with no password sets one through the reset link, and the link works once", async () => {
    const customer = user("user_customer"); // created before B05a: no password yet
    await forgotPasswordAction(null, form({ email: customer.email }));
    const resetLink = linkIn((await mail())[0]!);
    const landing = await openLink(resetLink);
    const token = new URL(landing.headers.get("location")!, "http://localhost:3000").searchParams.get("token")!;
    expect(token).toBeTruthy();

    const other = await signInAs(customer.id); // a session on another device
    signOutLocally();
    const done = await caught(resetPasswordAction(null, form({ token, password: GOOD })));
    expect(done?.message).toBe("redirect:/signin?reset=1");
    const sessions = await (await getAuth().$context).internalAdapter.listSessions(customer.id);
    expect(sessions.map((s) => s.token)).not.toContain(other.token); // every session ended

    const signedIn = await caught(signInAction(null, form({ email: customer.email, password: GOOD })));
    expect(signedIn?.message).toBe("redirect:/account");
    expect((await getSession())?.user.id).toBe(customer.id);

    signOutLocally();
    expect(await resetPasswordAction(null, form({ token, password: "yet-another-password" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("expired or was already used"),
    });
  });

  it("AU-04 a reset link stops working after 1 hour", async () => {
    const customer = user("user_customer");
    await forgotPasswordAction(null, form({ email: customer.email }));
    const landing = await openLink(linkIn((await mail())[0]!));
    const token = new URL(landing.headers.get("location")!, "http://localhost:3000").searchParams.get("token")!;
    // An hour and a minute later (the token's expiry, moved back instead of waiting).
    await migratorClient().verification.updateMany({
      where: { identifier: { contains: token } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await resetPasswordAction(null, form({ token, password: GOOD }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("expired or was already used"),
    });
  });

  it("changing the password ends every other session and keeps this one", async () => {
    await register("change@example.lk");
    await openLink(linkIn((await mail())[0]!));
    const me = (await getSession())!.user;
    const thisBrowser = jar.get(SESSION_COOKIE)!;
    const elsewhere = await signInAs(me.id);
    jar.set(SESSION_COOKIE, thisBrowser);

    expect(
      await changePasswordAction(null, form({ currentPassword: "wrong-password", password: "a-new-password-1" })),
    ).toMatchObject({ ok: false, fieldErrors: { currentPassword: expect.any(String) } });
    expect(
      await changePasswordAction(null, form({ currentPassword: GOOD, password: "a-new-password-1" })),
    ).toMatchObject({
      ok: true,
    });
    const tokens = (await (await getAuth().$context).internalAdapter.listSessions(me.id)).map((s) => s.token);
    expect(tokens).not.toContain(elsewhere.token);
    expect((await getSession())?.user.id).toBe(me.id);
  });

  it("a role change, and an approved shop application, end the person's sessions", async () => {
    await signInAs("user_applicant");
    expect((await getSession())?.user.id).toBe("user_applicant");
    await decideApplication(user("user_admin"), { decision: "approve", applicationId: "app_tharindu" });
    expect(await getSession()).toBeNull(); // signs in again, now as a seller

    await signInAs("user_customer");
    await changeRole(user("user_admin"), {
      userId: "user_customer",
      role: "ADMIN",
      reason: "Joining the support team.",
    });
    expect(await getSession()).toBeNull();
    expect((await freshUser("user_customer")).role).toBe("ADMIN");
  });

  it("AU-03 a session ends 30 days after sign-in, however often it was used", async () => {
    const session = await signInAs("user_customer");
    expect((await getSession())?.user.id).toBe("user_customer");
    const ctx = await getAuth().$context;
    await ctx.adapter.update({
      model: "session",
      where: [{ field: "id", value: session.id }],
      update: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    expect(await getSession()).toBeNull();
    expect((await ctx.internalAdapter.listSessions("user_customer")).map((s) => s.id)).not.toContain(session.id);
  });
});

describe("AU-11 a deleted account can't sign in", () => {
  it("deleting ends its sessions and removes its password; signing in again fails like a wrong password", async () => {
    await register("leaving@example.lk");
    await openLink(linkIn((await mail())[0]!));
    const me = (await getSession())!.user;
    await deleteMyAccount(me);
    expect(await getSession()).toBeNull();
    const again = await signInAction(null, form({ email: "leaving@example.lk", password: GOOD }));
    expect(again).toMatchObject({ ok: false, message: expect.stringContaining("don’t match an account") });
    await expect(signInAs(me.id)).rejects.toThrow(); // not even a session made by hand
  });
});

describe("AU-06 limits on sign-in, sign-up and reset", () => {
  it("allows 5 attempts per email in 15 minutes, from any IP", async () => {
    for (let i = 0; i < 5; i++) {
      testIp.value = `198.51.100.${i}`;
      expect(
        await signInAction(null, form({ email: "target@example.lk", password: "guess-number-" + i })),
      ).toMatchObject({
        ok: false,
        message: expect.stringContaining("don’t match"),
      });
    }
    testIp.value = "198.51.100.99";
    expect(await signInAction(null, form({ email: "target@example.lk", password: "guess-again" }))).toMatchObject({
      ok: false,
      message: "Too many attempts. Wait 15 minutes, then try again.",
    });
  });

  it("allows 5 attempts per IP in 15 minutes, whatever the email", async () => {
    for (let i = 0; i < 5; i++) await forgotPasswordAction(null, form({ email: `spray${i}@example.lk` }));
    expect(await forgotPasswordAction(null, form({ email: "spray9@example.lk" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("Too many attempts"),
    });
  });

  it("counts attempts in the database, so two app instances share one limit", async () => {
    const other = createPrismaClient(process.env.DATABASE_URL!);
    try {
      const otherInstance = handlesFor(() => other);
      const now = Date.now();
      await withTx((tx) => countAuthAttempt(tx, "ceyliving:test:shared", 900_000, now));
      const second = await otherInstance.withTx((tx) => countAuthAttempt(tx, "ceyliving:test:shared", 900_000, now));
      expect(second).toBe(2);
      const later = await withTx((tx) => countAuthAttempt(tx, "ceyliving:test:shared", 900_000, now + 900_001));
      expect(later).toBe(1); // a new window starts over
    } finally {
      await other.$disconnect();
    }
  });
});

describe("AU-09 / SEC-A8 demo sign-in", () => {
  it("works only with ENABLE_DEMO_LOGIN=true outside production, with a real session", async () => {
    expect((await caught(signInAsDemo(form({ userId: "user_seller" }))))?.message).toBe("redirect:/signin");
    expect(jar.has(SESSION_COOKIE)).toBe(false);

    vi.stubEnv("ENABLE_DEMO_LOGIN", "true");
    expect((await caught(signInAsDemo(form({ userId: "user_seller", next: "/seller" }))))?.message).toBe(
      "redirect:/seller",
    );
    expect((await getSession())?.user.id).toBe("user_seller");
  });

  it("is impossible in production, through the form and through Better Auth's route", async () => {
    vi.stubEnv("ENABLE_DEMO_LOGIN", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect((await caught(signInAsDemo(form({ userId: "user_admin" }))))?.message).toBe("redirect:/signin");
    const response = await getAuth().handler(
      new Request("http://localhost:3000/api/auth/demo/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ userId: "user_admin" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses accounts that aren't on the demo list", async () => {
    vi.stubEnv("ENABLE_DEMO_LOGIN", "true");
    expect((await caught(signInAsDemo(form({ userId: "user_muted" }))))?.message).toBe("redirect:/signin");
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });
});

describe("SEC-A1 server actions check the real session, not the page or the proxy", () => {
  const admin = () => import("./actions/admin");
  const extras = () => import("./actions/extras");
  const selling = () => import("./actions/selling");

  it("a signed-in customer calling admin and seller actions directly is refused, and nothing changes", async () => {
    await signInAs("user_customer");
    const before = await readAll();
    const shop = before.shops.find((s) => s.status === "ACTIVE")!;
    const pending = before.products.find((p) => p.status === "PENDING_REVIEW") ?? before.products[0]!;
    const sellerOrder = before.sellerOrders.find((so) => so.status === "NEW")!;
    const attempts = [
      (await admin()).decideShopAction(
        null,
        form({ decision: "suspend", shopId: shop.id, reason: "Pretending to be an admin." }),
      ),
      (await admin()).decideProductAction(null, form({ decision: "approve", productId: pending.id })),
      (await extras()).changeRoleAction(
        null,
        form({ userId: "user_customer", role: "ADMIN", reason: "Making myself an admin." }),
      ),
      (await selling()).archiveProductAction(null, form({ productId: pending.id })),
      (await selling()).transitionOrderAction(null, form({ sellerOrderId: sellerOrder.id, to: "ACCEPTED" })),
    ];
    for (const result of await Promise.all(attempts)) expect(result.ok, JSON.stringify(result)).toBe(false);

    const after = await readAll();
    expect(after.shops.find((s) => s.id === shop.id)?.status).toBe(shop.status);
    expect(after.products.find((p) => p.id === pending.id)?.status).toBe(pending.status);
    expect(after.users.find((u) => u.id === "user_customer")?.role).toBe("CUSTOMER");
    expect(after.sellerOrders.find((so) => so.id === sellerOrder.id)?.status).toBe("NEW");
  });

  it("with no session (or a forged cookie) the same actions ask to sign in", async () => {
    jar.set(SESSION_COOKIE, "forged.token");
    const result = await (
      await extras()
    ).changeRoleAction(null, form({ userId: "user_customer", role: "ADMIN", reason: "Making myself an admin." }));
    expect(result).toMatchObject({ ok: false, message: "Sign in to continue." });
  });
});
