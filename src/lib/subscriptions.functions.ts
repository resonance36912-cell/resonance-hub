import { createServerFn } from "@tanstack/react-start";
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
};

export const APP_META: Record<AppKey, { label: string; accent: string; url: string }> = {
  epublisher:        { label: "Resonance ePublisher",      accent: "#c026d3", url: "https://resonanceonline.life" },
  creative_studio:   { label: "Resonance Creative Studio", accent: "#a855f7", url: "https://www.creativestudio.life" },
  sync_vision:       { label: "Resonance Sync Vision",     accent: "#ec4899", url: "https://www.syncvision.life" },
  youtube_optimizer: { label: "YouTube Optimizer",         accent: "#06b6d4", url: "https://resonanceoptimizer.lovable.app" },
  all_access:        { label: "All-Access Bundle",         accent: "#f59e0b", url: "/pricing" },
};

export const getMySubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ subscriptions: SubscriptionRow[]; email: string | null }> => {
    const { supabase, userId, claims } = context;

    const { data, error } = await supabase
      .from("subscriptions")
      .select("id,app,tier,status,billing_cycle,amount_cents,currency,current_period_end,cancelled_at,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    return {
      subscriptions: (data ?? []) as SubscriptionRow[],
      email: (claims as { email?: string } | null)?.email ?? null,
    };
  });
