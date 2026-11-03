import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PaymentPoller } from "@/components/payments/payment-poller";
import { Container } from "@/components/ui/section-heading";
import { PAYMENT_WINDOW_MINUTES } from "@/lib/config";
import { formatLkr, formatTime } from "@/lib/format";
import { requireUser } from "@/lib/server/auth";
import { NotFoundError } from "@/lib/server/errors";
import { paymentResultFor } from "@/lib/server/services/payments";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

export const instant = false;

const heading = "text-[2.4rem] sm:text-[3rem]";

/**
 * Backend plan 9.1 step 7 / BR-09 (B08): PayHere's return_url. Shows the status from our database, which only the
 * verified notification changes; arriving here never marks anything paid.
 */
async function Result({ searchParams }: PageProps<"/checkout/result">) {
  const { order: param } = await searchParams;
  const orderNumber = typeof param === "string" ? param : "";
  const user = await requireUser(`/checkout/result?order=${encodeURIComponent(orderNumber)}`);
  let found;
  try {
    found = await paymentResultFor(user, orderNumber);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { order, result, canRetry, latePayment } = found;
  const heldUntil = order.expiresAt ? formatTime(order.expiresAt) : "";
  return (
    <div className="max-w-xl space-y-6" role="status">
      {result === "paid" ? (
        <>
          <h1 className={heading}>Thank you, it’s paid</h1>
          <p>
            We received {formatLkr(order.totalCents)} for {order.orderNumber}. The makers have been told and will accept
            your order shortly; we’ll keep you posted.
          </p>
        </>
      ) : result === "failed" || result === "cancelled" ? (
        <>
          <h1 className={heading}>{result === "cancelled" ? "Payment cancelled" : "The payment didn’t go through"}</h1>
          <p>
            Nothing was charged.{" "}
            {canRetry
              ? `Your items are still held until ${heldUntil}, so you can try again.`
              : "The order is no longer held."}
          </p>
        </>
      ) : result === "expired" ? (
        <>
          <h1 className={heading}>This order was cancelled</h1>
          <p>
            It wasn’t paid within {PAYMENT_WINDOW_MINUTES} minutes, so the items went back on sale.
            {latePayment
              ? " A payment arrived after that; it will be refunded to you in full."
              : " Nothing was charged."}
          </p>
        </>
      ) : result === "refunded" ? (
        <>
          <h1 className={heading}>Refunded</h1>
          <p>This order was paid and then refunded. See the order for details.</p>
        </>
      ) : (
        <>
          <h1 className={heading}>Waiting for PayHere</h1>
          <p>
            We haven’t heard from PayHere about {order.orderNumber} yet. If you paid, it’s usually confirmed within a
            few seconds.
          </p>
          <PaymentPoller />
        </>
      )}
      <div className="flex flex-wrap gap-3">
        {canRetry && (result === "failed" || result === "cancelled") ? (
          <Link
            href={`/checkout/pay/${order.orderNumber}`}
            className="inline-flex h-12 items-center rounded-full bg-forest px-7 font-semibold text-paper hover:bg-forest-deep"
          >
            Try again
          </Link>
        ) : null}
        <Link
          href={`/account/orders/${order.orderNumber}`}
          className="inline-flex h-12 items-center rounded-full border border-ink/25 px-6 font-semibold hover:border-ink"
        >
          See the order
        </Link>
      </div>
    </div>
  );
}

export default function PaymentResultPage(props: PageProps<"/checkout/result">) {
  return (
    <Container className="pt-6">
      <Suspense fallback={<div className="skeleton h-80 rounded-lg" aria-busy="true" />}>
        <Result {...props} />
      </Suspense>
    </Container>
  );
}
