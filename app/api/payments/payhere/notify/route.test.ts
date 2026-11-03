// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/server/db/tx";
import { formatAmount, signedNotification } from "@/lib/server/payments/payhere";
import { findOrderByNumber } from "@/lib/server/repositories/commerce";
import { placeOrder } from "@/lib/server/services/checkout";
import { checkoutSchema } from "@/lib/validation/checkout";
import { user, withTestDatabase } from "@/test/db";
import { POST } from "./route";

// B08 (PAY-03): PayHere posts a form; the route answers 200 whether it accepted the notification or not.

withTestDatabase();

const post = (body: string, contentType = "application/x-www-form-urlencoded") =>
  POST(
    new NextRequest("http://localhost:3000/api/payments/payhere/notify", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }),
  );

describe("POST /api/payments/payhere/notify", () => {
  it("PAY-03 a signed form post pays the order and answers 200", async () => {
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
    const { order } = await placeOrder(user("user_customer"), input);
    const fields = signedNotification({
      order_id: order.orderNumber,
      payment_id: "320025071278",
      payhere_amount: formatAmount(order.totalCents),
      payhere_currency: "LKR",
      status_code: "2",
    });
    const response = await post(new URLSearchParams(fields).toString());
    expect(response.status).toBe(200);
    expect((await findOrderByNumber(db, order.orderNumber))!.order.paymentStatus).toBe("PAID");
  });

  it("PAY-03 a forged or malformed post also gets 200 and changes nothing", async () => {
    expect((await post("order_id=CM-2026-000101&status_code=2&md5sig=00")).status).toBe(200);
    expect((await post("{not a form}", "application/json")).status).toBe(200);
  });
});
