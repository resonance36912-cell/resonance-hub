import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Input.parse(input))
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

    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("app,tier,status,current_period_end,updated_at")
      .eq("user_id", userId)
      .eq("app", def.app as never)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    const row = rows?.[0];
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
