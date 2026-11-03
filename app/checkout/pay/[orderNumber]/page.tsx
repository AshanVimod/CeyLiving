import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PayHereForm } from "@/components/payments/payhere-form";
import { SimulatePayment } from "@/components/payments/simulate-payment";
import { Container } from "@/components/ui/section-heading";
import { getEnv } from "@/lib/env";
import { formatLkr, formatTime } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { payPageFor } from "@/lib/server/services/payments";

export const metadata: Metadata = { title: "Pay", robots: { index: false } };

// Waits for the session and may redirect, so navigations here are allowed to block.
export const instant = false;

/**
 * Backend plan 9.1 step 5 (B08): sends the customer to PayHere with a form built on the server. Also PayHere's
 * cancel_url, and where "Try again" leads while the order is still held.
 */
async function Pay({ params, searchParams }: PageProps<"/checkout/pay/[orderNumber]">) {
  const { orderNumber } = await params;
  const { go } = await searchParams;
  const user = await requireUser(`/checkout/pay/${orderNumber}`);
  let page;
  try {
    page = await payPageFor(user, orderNumber);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (page.state === "done") redirect(`/checkout/result?order=${encodeURIComponent(orderNumber)}`);
  const { order, form, standIn, lastFailure } = page;
  const dev = getEnv().NODE_ENV !== "production";
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-[2.4rem] sm:text-[3rem]">Pay for {order.orderNumber}</h1>
      {lastFailure ? (
        <p role="alert" className="rounded-md bg-lacquer/10 px-4 py-3 text-lacquer">
          Your last payment {lastFailure.status === "CANCELLED" ? "was cancelled" : "didn’t go through"}. Nothing was
          charged. You can try again.
        </p>
      ) : null}
      <p>
        Total <span className="font-semibold tabular-nums">{formatLkr(order.totalCents)}</span>. Your items are held for
        you until <span className="font-semibold">{formatTime(order.expiresAt!)}</span>; after that the order is
        cancelled and nothing is charged.
      </p>
      <p className="text-ink-soft">
        You’ll enter your card or wallet details on PayHere’s secure page. CeyLiving never sees your card.
      </p>
      {standIn ? (
        <p className="rounded-md bg-turmeric-soft px-4 py-3 text-sm">
          PayHere isn’t set up on this computer (no PAYHERE_MERCHANT_SECRET), so PayHere would refuse the payment. Use
          the simulator below.
        </p>
      ) : (
        <PayHereForm
          action={form.action}
          fields={form.fields}
          label={`Pay ${formatLkr(order.totalCents)} with PayHere`}
          autoSubmit={go === "1" && !lastFailure}
        />
      )}
      {dev ? <SimulatePayment orderNumber={order.orderNumber} /> : null}
      <p>
        <Link
          href={`/account/orders/${order.orderNumber}`}
          className="text-sm font-semibold text-forest underline underline-offset-4"
        >
          See the order
        </Link>
      </p>
    </div>
  );
}

export default function PayPage(props: PageProps<"/checkout/pay/[orderNumber]">) {
  return (
    <Container className="pt-6">
      <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
        <Pay {...props} />
      </Suspense>
    </Container>
  );
}
