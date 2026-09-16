import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppKey =
  | "epublisher"
  | "creative_studio"
  | "sync_vision"
  | "youtube_optimizer"
  | "all_access";

export type SubscriptionRow = {
  id: string;
  app: AppKey;
  tier: string;
  status: "pending" | "active" | "past_due" | "cancelled";
  billing_cycle: string;
  amount_cents: number;
  currency: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  updated_at: string;
  cancel_at_period_end: boolean;
  grace_period_ends_at: string | null;
  product_id: string | null;
};

export const APP_META: Record<AppKey, { label: string; accent: string; url: string }> = {
  epublisher:        { label: "Resonance ePublisher",      accent: "#c026d3", url: "https://epublisher.reson8.life" },
  creative_studio:   { label: "Resonance Creative Studio", accent: "#a855f7", url: "https://creative.reson8.life" },
  sync_vision:       { label: "Resonance Sync Vision",     accent: "#ec4899", url: "https://sync.reson8.life" },
  youtube_optimizer: { label: "YouTube Optimizer",         accent: "#06b6d4", url: "https://resonanceoptimizer.lovable.app" },
  all_access:        { label: "All-Access Bundle",         accent: "#f59e0b", url: "/pricing" },
};

const SELECT_COLS =
  "id,app,tier,status,billing_cycle,amount_cents,currency,current_period_end,cancelled_at,updated_at,cancel_at_period_end,grace_period_ends_at,product_id";

export const getMySubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ subscriptions: SubscriptionRow[]; email: string | null }> => {
    const { supabase, userId, claims } = context;

    const { data, error } = await supabase
      .from("subscriptions")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    return {
      subscriptions: (data ?? []) as SubscriptionRow[],
      email: (claims as { email?: string } | null)?.email ?? null,
    };
  });

/**
 * Flag a subscription to cancel at the end of the current paid period.
 * The user retains access until `current_period_end`, at which point the
 * `expire_stale_subscriptions()` sweep flips status to 'cancelled'. If the
 * period has already elapsed, this call cancels immediately.
 *
 * Idempotent: calling on an already-cancelled subscription is a no-op.
 * Only the subscription owner may call (RLS enforces).
 */
const IdInput = z.object({ subscriptionId: z.string().uuid() });

export const cancelSubscriptionAtPeriodEnd = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => IdInput.parse(input))
  .handler(async ({ data, context }): Promise<SubscriptionRow> => {
    const { supabase, userId } = context;

    const { data: existing, error: readErr } = await supabase
      .from("subscriptions")
      .select(SELECT_COLS)
      .eq("id", data.subscriptionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Subscription not found");
    if (existing.status === "cancelled") return existing as SubscriptionRow;

    const periodEnd = existing.current_period_end
      ? new Date(existing.current_period_end).getTime()
      : null;
    const cancelNow = !periodEnd || periodEnd <= Date.now();

    const patch = cancelNow
      ? { status: "cancelled" as const, cancelled_at: new Date().toISOString(), cancel_at_period_end: true }
      : { cancel_at_period_end: true };

    const { data: updated, error: updErr } = await supabase
      .from("subscriptions")
      .update(patch)
      .eq("id", data.subscriptionId)
      .eq("user_id", userId)
      .select(SELECT_COLS)
      .single();
    if (updErr) throw new Error(updErr.message);
    return updated as SubscriptionRow;
  });

/**
 * Clear the cancel-at-period-end flag so the subscription continues to renew.
 * Only valid while the subscription is still `active` (or `past_due` within
 * grace) — a fully cancelled row must go through checkout again.
 */
export const reactivateSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => IdInput.parse(input))
  .handler(async ({ data, context }): Promise<SubscriptionRow> => {
    const { supabase, userId } = context;

    const { data: existing, error: readErr } = await supabase
      .from("subscriptions")
      .select(SELECT_COLS)
      .eq("id", data.subscriptionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Subscription not found");
    if (existing.status === "cancelled") {
      throw new Error("Subscription is already cancelled — start a new checkout to resume.");
    }

    const { data: updated, error: updErr } = await supabase
      .from("subscriptions")
      .update({ cancel_at_period_end: false })
      .eq("id", data.subscriptionId)
      .eq("user_id", userId)
      .select(SELECT_COLS)
      .single();
    if (updErr) throw new Error(updErr.message);
    return updated as SubscriptionRow;
  });
