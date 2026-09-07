import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequest } from "@tanstack/react-start/server";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import { fetchSubscriptionDetails } from "@/lib/backend-provider.server";
import { SKU_CATALOG } from "@/lib/checkout.functions";

/**
 * Verify a checkout completed by reading the current user's subscriptions
 * table. Access is only granted after the PayFast ITN webhook wrote an
 * `active` row — the browser return URL is never proof of payment.
 *
 * Returns `verified: true` when the signed-in user has a subscription for
 * the SKU's app with status='active' AND the row was updated in the last
 * 30 minutes (proving this checkout, not an older one).
 */
const Input = z.object({ sku: z.string().min(1) });

export type VerifiedPurchase = {
  verified: boolean;
  status: "active" | "pending" | "past_due" | "cancelled" | "unknown";
  app: string | null;
  tier: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string | null;
};

const FRESH_WINDOW_MS = 30 * 60 * 1000;

export const getVerifiedPurchase = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input) => Input.parse(input))
  .handler(async ({ data, context }): Promise<VerifiedPurchase> => {
    const def = SKU_CATALOG[data.sku];
    if (!def) {
      return {
        verified: false,
        status: "unknown",
        app: null,
        tier: null,
        currentPeriodEnd: null,
        updatedAt: null,
      };
    }

    const request = getRequest();
    const credential = request ? resolveRonsRequestCredential(request) : null;
    if (!credential) throw new Error("Authenticated request credential unavailable");
    const rows = await fetchSubscriptionDetails(credential, context.userId);
    const row = rows
      .filter((candidate) => candidate.app === def.app)
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
    if (!row) {
      return {
        verified: false,
        status: "pending",
        app: def.app,
        tier: def.tier,
        currentPeriodEnd: null,
        updatedAt: null,
      };
    }

    const fresh = row.updated_at
      ? Date.now() - new Date(row.updated_at).getTime() < FRESH_WINDOW_MS
      : false;
    const verified = row.status === "active" && fresh;

    return {
      verified,
      status: row.status as VerifiedPurchase["status"],
      app: row.app,
      tier: row.tier,
      currentPeriodEnd: row.current_period_end,
      updatedAt: row.updated_at,
    };
  });
