"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PAYMENT_RESULT_POLL } from "@/lib/config";

/**
 * Backend plan 9.1 step 7: while the payment is still pending, re-reads the page from the server every couple of
 * seconds for a short while (PayHere's notification usually lands within seconds), then stops and says so.
 */
export function PaymentPoller() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= PAYMENT_RESULT_POLL.forMs) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, PAYMENT_RESULT_POLL.everyMs);
    return () => clearInterval(timer);
  }, [router]);
  return gaveUp ? (
    <p className="text-sm text-ink-soft">
      Still waiting for PayHere. We’ll send you a notification as soon as it confirms; you can leave this page.
    </p>
  ) : (
    <p className="text-sm text-ink-soft" aria-live="polite">
      Checking with PayHere…
    </p>
  );
}
