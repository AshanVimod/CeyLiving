"use client";

import { decideShopAction } from "@/lib/server/actions/admin";
import type { ShopStatus } from "@/lib/types";
import { ConfirmAction } from "./confirm-action";

/** FR-4 actions on one shop, offered only where the status flow allows them. */
export function ShopDecisions({ shopId, name, status, isVerified }: { shopId: string; name: string; status: ShopStatus; isVerified: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      {status === "ACTIVE" ? (
        <ConfirmAction
          action={decideShopAction}
          label="Suspend"
          title={`Suspend ${name}?`}
          description="The shop and all its items disappear from the site immediately. Open orders continue. The seller is told the reason."
          fields={{ shopId, decision: "suspend" }}
          reason={{ label: "Reason (shown to the seller)" }}
          confirmLabel="Suspend shop"
          tone="danger"
        />
      ) : null}
      {status === "SUSPENDED" ? (
        <ConfirmAction
          action={decideShopAction}
          label="Reinstate"
          title={`Reinstate ${name}?`}
          description="The shop and its active items appear on the site again."
          fields={{ shopId, decision: "reinstate" }}
          confirmLabel="Reinstate shop"
        />
      ) : null}
      {status !== "CLOSED" ? (
        <ConfirmAction
          action={decideShopAction}
          label={isVerified ? "Remove verified badge" : "Verify maker"}
          title={isVerified ? "Remove the verified badge?" : `Verify ${name}?`}
          description={isVerified ? "The “Verified maker” badge disappears from the shop." : "Only verify after checking identity and bank details (spec BR-14)."}
          fields={{ shopId, decision: isVerified ? "unverify" : "verify" }}
          confirmLabel={isVerified ? "Remove badge" : "Verify"}
          tone="secondary"
        />
      ) : null}
      {status !== "CLOSED" ? (
        <ConfirmAction
          action={decideShopAction}
          label="Close shop"
          title={`Close ${name} permanently?`}
          description="Only possible with no open orders. Items are archived and the owner becomes a customer again. This can’t be undone."
          fields={{ shopId, decision: "close" }}
          reason={{ label: "Reason" }}
          confirmLabel="Close permanently"
          tone="danger"
        />
      ) : null}
    </div>
  );
}
