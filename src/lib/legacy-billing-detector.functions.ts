/**
 * Stage 10 — Legacy billing detector.
 *
 * Surfaces active subscriptions and PayFast ITN rows whose SKU is not present
 * in `public.products`. During the satellite decommission window this list
 * MUST trend to zero; any persistent row means a spoke is still driving
 * billing through a SKU the hub no longer recognises.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LegacySubRow = {
  subscription_id: string;
  user_id: string;
  app: string;
  tier: string;
  status: string;
  reason: string;
  current_period_end: string | null;
};

export type LegacyItnRow = {
  itn_id: string;
  received_at: string;
  pf_payment_id: string | null;
  sku: string;
  amount_cents: number | null;
  user_id: string | null;
};

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

async function knownProductKeys(): Promise<Set<string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("products").select("product_key");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.product_key as string));
}

export const listLegacySubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LegacySubRow[]> => {
    await requireAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Active / past_due / pending subs with no product_id mapping — these
    // were written by legacy spoke checkout paths and predate Stage 3.
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, app, tier, status, product_id, current_period_end")
      .in("status", ["active", "past_due", "pending"])
      .is("product_id", null)
      .order("current_period_end", { ascending: true, nullsFirst: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      subscription_id: r.id,
      user_id: r.user_id,
      app: r.app as string,
      tier: r.tier as string,
      status: r.status as string,
      reason: "no product_id (pre-Stage 3)",
      current_period_end: r.current_period_end,
    }));
  });


export const listLegacyItns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LegacyItnRow[]> => {
    await requireAdmin(context as any);
    const skus = await knownSkus();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("payfast_itn_logs")
      .select("id, received_at, pf_payment_id, sku, amount_cents, user_id, payment_status")
      .gte("received_at", since)
      .eq("payment_status", "COMPLETE")
      .order("received_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((r: any) => r.sku && !skus.has(r.sku))
      .map((r: any) => ({
        itn_id: r.id,
        received_at: r.received_at,
        pf_payment_id: r.pf_payment_id,
        sku: r.sku,
        amount_cents: r.amount_cents,
        user_id: r.user_id,
      }));
  });
