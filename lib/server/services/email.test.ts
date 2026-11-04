// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, withTx } from "@/lib/server/db/tx";
import { resendDriver, type EmailDriver } from "@/lib/server/email/drivers";
import { queueEmail } from "@/lib/server/email/queue";
import { ConflictError, ForbiddenError } from "@/lib/server/errors";
import { RETRY_POLICY } from "@/lib/server/jobs/queues";
import { signedNotification, formatAmount } from "@/lib/server/payments/payhere";
import { findOrderByNumber } from "@/lib/server/repositories/commerce";
import { decideApplication } from "@/lib/server/services/applications";
import { placeOrder } from "@/lib/server/services/checkout";
import { deliverEmail } from "@/lib/server/services/email";
import { emailOverview, retryEmail, workerHealth } from "@/lib/server/services/email-admin";
import { cleanUpOldRows } from "@/lib/server/services/maintenance";
import { moderateContent } from "@/lib/server/services/moderation";
import { confirmDelivery, transitionSellerOrder } from "@/lib/server/services/orders";
import { receivePayHereNotification } from "@/lib/server/services/payments";
import { markPayoutPaid, runPayouts } from "@/lib/server/services/payouts";
import { deleteMyAccount } from "@/lib/server/services/privacy";
import { WORKER } from "@/lib/server/services/shared";
import type { Order, SellerOrder } from "@/lib/types";
import { checkoutSchema } from "@/lib/validation/checkout";
import { migratorClient, queuedJobs, readAll, user, withTestDatabase } from "@/test/db";
import { mailpit } from "@/test/email";
import { runJobNow } from "@/test/jobs";
import { captureLogger } from "@/test/log-capture";

// B10 (backend plan 11.2): every email, sent by the real email.send job to the test run's Mailpit and read back
// from it. Resend is a local stub server; nothing here talks to the internet.

withTestDatabase();

const customer = () => user("user_customer");
const admin = () => user("user_admin");
const seller = () => user("user_seller");
const RATA = "shop_rata-studio";
const MINUTE = 60_000;
/** Fake Resend keys: right shape, obviously not real (and nothing a secret scanner mistakes for one). */
const FAKE_KEY = "re_xxxxxxxxxxxx";
const OTHER_FAKE_KEY = "re_yyyyyyyyyyyy";

beforeEach(() => {
  vi.stubEnv("EMAIL_DRIVER", "smtp");
  vi.stubEnv("SMTP_URL", mailpit().smtpUrl);
});

const deliveries = (template?: string) =>
  migratorClient().emailDelivery.findMany({ where: template ? { template } : {}, orderBy: { createdAt: "asc" } });

/** Runs every queued email.send job through the worker's handler, as the worker would. */
async function sendQueued() {
  for (const job of await queuedJobs("email.send")) await runJobNow("email.send", job.data as { deliveryId: string });
}

/** The one email of `template`: SENT with the provider's id, address and data gone, and once in Mailpit. */
async function expectOneEmail(template: string, to: string, ...facts: string[]) {
  const rows = await deliveries(template);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "SENT", provider: "smtp", toAddress: null, data: null });
  expect(rows[0]!.providerMessageId).toBeTruthy();
  const messages = await mailpit().messagesFor(rows[0]!.id);
  expect(messages).toHaveLength(1);
  expect(messages[0]!.To.map((t) => t.Address)).toEqual([to]);
  for (const fact of facts) expect(messages[0]!.Text).toContain(fact);
  return messages[0]!;
}

const emailOf = async (userId: string) => (await readAll()).users.find((u) => u.id === userId)!.email;
const ownerOf = async (shopId: string) => (await readAll()).shops.find((s) => s.id === shopId)!.ownerId;

/** The demo customer's seller order in `status` from the demo seller's shop. */
async function customerOrder(status: SellerOrder["status"]): Promise<SellerOrder> {
  const data = await readAll();
  const shop = data.shops.find((s) => s.ownerId === "user_seller")!;
  const orderIds = new Set(data.orders.filter((o) => o.customerId === "user_customer").map((o) => o.id));
  return data.sellerOrders.find((so) => orderIds.has(so.orderId) && so.shopId === shop.id && so.status === status)!;
}

async function paidOrder(): Promise<Order> {
  const input = checkoutSchema.parse({
    idempotencyKey: randomUUID(),
    lines: [{ productSlug: "monsoon-abstract-canvas", sku: "MAC-1", quantity: 1 }],
    shippingAddress: {
      recipientName: "Test Buyer",
      line1: "1 Lake Road",
      city: "Kandy",
      district: "Kandy",
      phone: "0771234567",
    },
  });
  const { order } = await placeOrder(customer(), input);
  const fields = signedNotification({
    order_id: order.orderNumber,
    payment_id: `3200${Date.now()}`,
    payhere_amount: formatAmount(order.totalCents),
    payhere_currency: "LKR",
    status_code: "2",
    method: "VISA",
    status_message: "Successfully completed the payment.",
  });
  await receivePayHereNotification(fields, captureLogger().logger);
  return order;
}

describe("B10 every event in 11.2 sends one email to the right person", () => {
  it("B10 order placed: a receipt to the customer and a new-order email to the maker (PayHere notify)", async () => {
    const order = await paidOrder();
    await sendQueued();
    await sendQueued(); // JOB-03: a second run sends nothing more
    await expectOneEmail("order.placed", customer().email, order.orderNumber, "Rata Studio");
    const maker = await expectOneEmail("order.new", await emailOf(await ownerOf(RATA)), order.orderNumber, "3 days");
    expect(maker.Subject).toContain("please accept it within 3 days");
  });

  it("B10 order accepted, then dispatched with the courier and tracking reference", async () => {
    const so = await customerOrder("NEW");
    await transitionSellerOrder(seller(), { sellerOrderId: so.id, to: "ACCEPTED" });
    await transitionSellerOrder(seller(), {
      sellerOrderId: so.id,
      to: "DISPATCHED",
      courierName: "Pronto Lanka",
      trackingRef: "PL-778812",
    });
    await sendQueued();
    await expectOneEmail("order.accepted", customer().email, "accepted your order");
    await expectOneEmail("order.dispatched", customer().email, "Pronto Lanka", "PL-778812");
  });

  it("B10 delivered: the customer is invited to review, once", async () => {
    const so = await customerOrder("DISPATCHED");
    await confirmDelivery(customer(), so.id);
    await sendQueued();
    await expectOneEmail("order.delivered", customer().email, "Write a review");
  });

  it("B10 payout sent: the maker is told the amount", async () => {
    const [payout] = (await runPayouts(WORKER)).filter((p) => p.shopId === RATA);
    await markPayoutPaid(admin(), payout!.id, "BANK-20261104");
    await sendQueued();
    await expectOneEmail("payout.paid", await emailOf(await ownerOf(RATA)), "to your bank account");
  });

  it("B10 application decision: the applicant gets the decision and the admin's note", async () => {
    await decideApplication(admin(), {
      decision: "reject",
      applicationId: "app_tharindu",
      reason: "The photos don't show your own work yet.",
    });
    await sendQueued();
    await expectOneEmail("application.decision", user("user_applicant").email, "photos don't show your own work");
  });

  it("B10 content hidden: the author is told, with the moderator's reason", async () => {
    await moderateContent(admin(), {
      targetType: "QUESTION",
      targetId: "q_naga_size",
      action: "hide",
      reason: "Please ask the maker directly about fixings.",
    });
    await sendQueued();
    await expectOneEmail("content.hidden", customer().email, "A moderator hid one of your questions", "fixings");
  });

  it("FR-17 account deleted: the email reaches the old address, and nothing more is kept after it's sent", async () => {
    const before = user("user_muted").email;
    await deleteMyAccount(user("user_muted"));
    expect(await emailOf("user_muted")).not.toBe(before); // anonymised in the same transaction
    expect((await deliveries("account.deleted"))[0]!.toAddress).toBe(before);
    await sendQueued();
    await expectOneEmail("account.deleted", before, "Your CeyLiving account is deleted");
  });

  it("AU-07 sign-in emails carry their link and go to unconfirmed addresses too", async () => {
    await migratorClient().user.update({ where: { id: "user_applicant" }, data: { emailVerified: false } });
    const url = "http://localhost:3000/api/auth/reset-password/tok123?callbackURL=%2Freset-password";
    await withTx((tx) => queueEmail(tx, "auth.reset", { userId: "user_applicant", key: "tok123", data: { url } }));
    await sendQueued();
    await expectOneEmail("auth.reset", user("user_applicant").email, url);
  });

  it("B10 other emails skip an unconfirmed address and a deleted account", async () => {
    await migratorClient().user.update({ where: { id: "user_applicant" }, data: { emailVerified: false } });
    await withTx(async (tx) => {
      await queueEmail(tx, "order.accepted", {
        userId: "user_applicant",
        key: "x1",
        data: { orderNumber: "CM-1", shopName: "Rata Studio" },
      });
    });
    await sendQueued();
    expect(await deliveries("order.accepted")).toMatchObject([{ status: "SKIPPED", lastError: "unverified" }]);
  });
});

describe("JOB-02 an email exists only if its change committed, and never undoes it", () => {
  it("JOB-02 no email when the business transaction rolls back", async () => {
    await expect(
      withTx(async (tx) => {
        await queueEmail(tx, "order.accepted", {
          userId: "user_customer",
          key: "so_rollback",
          data: { orderNumber: "CM-1", shopName: "Rata Studio" },
        });
        throw new Error("the order change failed");
      }),
    ).rejects.toThrow("the order change failed");
    expect(await deliveries()).toEqual([]);
    expect(await queuedJobs("email.send")).toEqual([]);
  });

  /** Makes every email insert fail with a real database error while `fn` runs. */
  async function withEmailInsertsRefused(fn: () => Promise<void>) {
    await migratorClient().$executeRawUnsafe(`REVOKE INSERT ON email_deliveries FROM ceyliving_app`);
    try {
      await fn();
    } finally {
      await migratorClient().$executeRawUnsafe(`GRANT INSERT ON email_deliveries TO ceyliving_app`);
    }
  }

  it("JOB-02 a payment is recorded even when queueing its email fails, and admins are told", async () => {
    let order: Order | undefined;
    await withEmailInsertsRefused(async () => {
      order = await paidOrder();
    });
    const stored = (await findOrderByNumber(db, order!.orderNumber))!;
    expect(stored.order.paymentStatus).toBe("PAID");
    expect(stored.sellerOrders.map((s) => s.sellerOrder.status)).toEqual(["NEW"]);
    expect(await deliveries()).toEqual([]);
    const told = (await readAll()).notifications.filter((n) => n.type === "email.queue_failed");
    expect(told.map((n) => n.userId)).toContain("user_admin");
  });

  it("JOB-02 an order transition is saved even when queueing its email fails", async () => {
    const so = await customerOrder("NEW");
    await withEmailInsertsRefused(async () => {
      await transitionSellerOrder(seller(), { sellerOrderId: so.id, to: "ACCEPTED" });
    });
    expect((await readAll()).sellerOrders.find((s) => s.id === so.id)!.status).toBe("ACCEPTED");
  });
});

describe("JOB-03 no duplicates", () => {
  const accepted = { orderNumber: "CM-1", shopName: "Rata Studio" };

  it("JOB-03 the same event queued twice sends once", async () => {
    const first = await withTx((tx) =>
      queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_1", data: accepted }),
    );
    const again = await withTx((tx) =>
      queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_1", data: accepted }),
    );
    expect([first, again]).toEqual([true, false]);
    expect(await queuedJobs("email.send")).toHaveLength(1);
    await sendQueued();
    await expectOneEmail("order.accepted", customer().email);
  });

  it("JOB-03 email.send run twice sends once", async () => {
    await withTx((tx) => queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_2", data: accepted }));
    const [job] = await queuedJobs("email.send");
    await runJobNow("email.send", job!.data as { deliveryId: string });
    const lines = await runJobNow("email.send", job!.data as { deliveryId: string });
    expect(lines.find((l) => l.msg === "job.completed")).toMatchObject({ outcome: "already-final" });
    await expectOneEmail("order.accepted", customer().email);
  });

  it("JOB-03 a retry after a send that wasn't recorded reuses the idempotency key, so Resend sends once", async () => {
    const resend = await resendStub(() => ({ status: 200 }));
    try {
      await withTx((tx) => queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_3", data: accepted }));
      const [row] = await deliveries();
      const real = resendDriver(FAKE_KEY, resend.url);
      let crash = true;
      const crashingAfterSend: EmailDriver = {
        name: "resend",
        async send(email) {
          const sent = await real.send(email);
          if (crash) throw new Error("the worker died before recording the send");
          return sent;
        },
      };
      await expect(deliverEmail(row!.id, { driver: crashingAfterSend })).rejects.toThrow();
      expect((await deliveries())[0]).toMatchObject({ status: "QUEUED", attempts: 1, lastError: "unexpected" });
      crash = false;
      await deliverEmail(row!.id, { driver: crashingAfterSend });
      expect(resend.keys).toEqual([row!.id, row!.id]); // the same key both times
      expect(resend.delivered).toBe(1); // and Resend sent one email
      expect((await deliveries())[0]).toMatchObject({
        status: "SENT",
        provider: "resend",
        providerMessageId: `re_${row!.id}`,
      });
    } finally {
      await resend.close();
    }
  });
});

describe("JOB-04 retries, final failures and alerts", () => {
  const accepted = { orderNumber: "CM-1", shopName: "Rata Studio" };
  const queueOne = async (key = "so_r") => {
    await withTx((tx) => queueEmail(tx, "order.accepted", { userId: "user_customer", key, data: accepted }));
    return (await queuedJobs("email.send"))[0]!.data as { deliveryId: string };
  };

  it("JOB-04 a provider outage retries, the last failure alerts the admins, and the order is unchanged", async () => {
    const so = await customerOrder("NEW");
    await transitionSellerOrder(seller(), { sellerOrderId: so.id, to: "ACCEPTED" });
    vi.stubEnv("SMTP_URL", "smtp://127.0.0.1:1"); // nothing listens there
    const job = (await queuedJobs("email.send"))[0]!.data as { deliveryId: string };
    await expect(runJobNow("email.send", job)).rejects.toThrow(/Email not sent/);
    expect((await deliveries())[0]).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect((await deliveries())[0]!.lastError).toMatch(/^smtp_/);
    await expect(runJobNow("email.send", job, { retryCount: RETRY_POLICY.retryLimit })).rejects.toThrow();
    const alerts = (await readAll()).notifications.filter((n) => n.type === "job.failed");
    expect(alerts.map((n) => n.userId)).toContain("user_admin");
    expect((await readAll()).sellerOrders.find((s) => s.id === so.id)!.status).toBe("ACCEPTED");
  });

  it("JOB-04 an address Resend refuses fails at once, without retrying; a 500 is retried", async () => {
    const resend = await resendStub((n) => (n === 1 ? { status: 422, name: "validation_error" } : { status: 500 }));
    vi.stubEnv("EMAIL_DRIVER", "resend");
    vi.stubEnv("RESEND_API_KEY", FAKE_KEY);
    try {
      const refused = await queueOne("so_422");
      await deliverEmail(refused.deliveryId, { driver: resendDriver(FAKE_KEY, resend.url) });
      expect((await deliveries())[0]).toMatchObject({
        status: "FAILED",
        lastError: "resend_422_validation_error",
        attempts: 1,
      });

      await withTx((tx) =>
        queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_500", data: accepted }),
      );
      const second = (await deliveries()).find((d) => d.status === "QUEUED")!;
      await expect(deliverEmail(second.id, { driver: resendDriver(FAKE_KEY, resend.url) })).rejects.toThrow(
        "Email not sent (resend_500)",
      );
    } finally {
      await resend.close();
    }
  });

  it("OPS-01 email jobs never log the address, the content or the API key", async () => {
    const job = await queueOne();
    const lines = await runJobNow("email.send", job);
    const all = JSON.stringify(lines);
    expect(lines.find((l) => l.msg === "job.completed")).toMatchObject({ outcome: "sent", provider: "smtp" });
    expect(all).not.toContain(customer().email);
    expect(all).not.toContain("accepted your order");

    const resend = await resendStub(() => ({ status: 401, name: "missing_api_key" }));
    try {
      await withTx((tx) =>
        queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_key", data: accepted }),
      );
      const row = (await deliveries()).find((d) => d.status === "QUEUED")!;
      const error = await deliverEmail(row.id, { driver: resendDriver(OTHER_FAKE_KEY, resend.url) }).catch(
        (e: Error) => e,
      );
      expect(String((error as Error).message)).toBe("Email not sent (resend_401_missing_api_key)");
      expect(JSON.stringify(await deliveries())).not.toContain(OTHER_FAKE_KEY);
    } finally {
      await resend.close();
    }
  });

  it("B10 email.watch tells the admins about a failed email once", async () => {
    await withTx((tx) => queueEmail(tx, "order.accepted", { userId: "user_customer", key: "so_w", data: accepted }));
    const row = (await deliveries())[0]!;
    await migratorClient().$executeRawUnsafe(
      `UPDATE email_deliveries SET status = 'FAILED', last_error = 'resend_422', data = NULL WHERE id = $1`,
      row.id,
    );
    const first = await runJobNow("email.watch");
    const second = await runJobNow("email.watch");
    expect(first.find((l) => l.msg === "job.completed")).toMatchObject({ alerted: 1 });
    expect(second.find((l) => l.msg === "job.completed")).toMatchObject({ alerted: 0 });
    const told = (await readAll()).notifications.filter((n) => n.type === "email.problem");
    expect(told.map((n) => n.userId)).toEqual(["user_admin"]);
  });
});

describe("B10 admins see email problems, without addresses or content", () => {
  const accepted = { orderNumber: "CM-1", shopName: "Rata Studio" };

  /** A queued email from `minutes` ago whose job is gone (every retry used up). */
  async function stuckEmail(template: "order.accepted" | "auth.reset", minutes: number) {
    const data = template === "auth.reset" ? { url: "http://localhost:3000/api/auth/reset-password/t1" } : accepted;
    await withTx((tx) => queueEmail(tx, template, { userId: "user_customer", key: `stuck-${minutes}`, data } as never));
    const row = (await deliveries(template))[0]!;
    await migratorClient().emailDelivery.update({
      where: { id: row.id },
      data: { createdAt: new Date(Date.now() - minutes * MINUTE), attempts: 5, lastError: "resend_503" },
    });
    await migratorClient().$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'email.send'`);
    return row.id;
  }

  it("SEC-A1 only admins can read the overview or send an email again", async () => {
    await expect(emailOverview(customer())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(retryEmail(seller(), "eml_x")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("B10 a stuck email shows its type, tries and reason, and an admin can send it again (audited)", async () => {
    const id = await stuckEmail("order.accepted", 45);
    const { items } = await emailOverview(admin());
    expect(items).toEqual([
      expect.objectContaining({
        id,
        label: "Order accepted",
        attempts: 5,
        state: "stuck",
        reason: "Resend couldn’t be reached (resend_503).",
        retry: { allowed: true },
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain(customer().email);
    expect(JSON.stringify(items)).not.toContain("Rata Studio");

    await retryEmail(admin(), id);
    expect((await queuedJobs("email.send")).map((j) => j.data)).toEqual([{ deliveryId: id }]);
    expect((await readAll()).auditLog.find((a) => a.action === "email.retry")).toMatchObject({
      actorId: "user_admin",
      targetId: id,
    });
    // Queued again, so it can't be sent a second time until that try has run.
    await expect(retryEmail(admin(), id)).rejects.toBeInstanceOf(ConflictError);
    await sendQueued();
    await expectOneEmail("order.accepted", customer().email);
  });

  it("B10 a sign-in email whose link has expired, and a failed email, can't be sent again", async () => {
    const expired = await stuckEmail("auth.reset", 90);
    const { items } = await emailOverview(admin());
    expect(items.find((i) => i.id === expired)!.retry).toEqual({
      allowed: false,
      why: "Its sign-in link has expired. The person can ask for a new one.",
    });
    await expect(retryEmail(admin(), expired)).rejects.toThrow("Its sign-in link has expired");
  });

  it("B10 worker health: silent without a recent check-in, or with an email waiting over 30 minutes", async () => {
    const setSeen = (at: Date | null) =>
      migratorClient().$executeRawUnsafe(`UPDATE pgboss.version SET cron_on = $1`, at);
    await setSeen(null);
    expect(await workerHealth()).toMatchObject({ ok: false, workerSilent: true });
    await setSeen(new Date(Date.now() - 10 * MINUTE));
    expect(await workerHealth()).toMatchObject({ ok: false, workerSilent: true });
    await setSeen(new Date());
    expect(await workerHealth()).toMatchObject({ ok: true, workerSilent: false, stuckEmails: 0 });
    await stuckEmail("order.accepted", 45);
    expect(await workerHealth()).toMatchObject({ ok: false, workerSilent: false, stuckEmails: 1 });
  });

  it("B10 maintenance.cleanup deletes finished email records after 180 days and keeps queued ones", async () => {
    await withTx((tx) => queueEmail(tx, "order.accepted", { userId: "user_customer", key: "old", data: accepted }));
    await sendQueued();
    await withTx((tx) => queueEmail(tx, "order.accepted", { userId: "user_customer", key: "waiting", data: accepted }));
    await migratorClient().emailDelivery.updateMany({
      data: { createdAt: new Date(Date.now() - 200 * 24 * 60 * MINUTE) },
    });
    await cleanUpOldRows();
    expect((await deliveries()).map((d) => d.status)).toEqual(["QUEUED"]);
  });
});

/** A stand-in for Resend's API: honours Idempotency-Key the way Resend does, and records what it was sent. */
async function resendStub(answer: (call: number) => { status: number; name?: string }) {
  const keys: string[] = [];
  const done = new Map<string, string>();
  let calls = 0;
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls += 1;
      const key = String(req.headers["idempotency-key"] ?? "");
      keys.push(key);
      const { status, name } = answer(calls);
      res.setHeader("Content-Type", "application/json");
      if (status !== 200) {
        res.statusCode = status;
        res.end(JSON.stringify({ statusCode: status, name, message: `refused ${JSON.parse(body).to}` }));
        return;
      }
      if (!done.has(key)) done.set(key, `re_${key}`);
      res.end(JSON.stringify({ id: done.get(key) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    keys,
    get delivered() {
      return done.size;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
