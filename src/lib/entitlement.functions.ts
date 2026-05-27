import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AppSchema = z.enum([
  "epublisher",
  "creative_studio",
  "sync_vision",
  "youtube_optimizer",
  "all_access",
]);

export type AppKey = z.infer<typeof AppSchema>;

export type Entitlement = {
  app: AppKey;
  tier: "free" | "starter" | "creator" | "pro" | "business" | "all_access";
  status: "pending" | "active" | "past_due" | "cancelled";
  currentPeriodEnd: string | null;
  hasAccess: boolean;
};

/**
 * Resolve a user's effective tier for a given app.
 * If the user holds an active `all_access` bundle, that wins.
 */
export const getEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { app: AppKey }) => ({ app: AppSchema.parse(input.app) }))
  .handler(async ({ data, context }): Promise<Entitlement> => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("app,tier,status,current_period_end")
      .eq("user_id", userId)
      .in("app", [data.app, "all_access"]);

    if (error) {
      console.error("getEntitlement query failed:", error);
      return {
        app: data.app,
        tier: "free",
        status: "pending",
        currentPeriodEnd: null,
        hasAccess: false,
      };
    }

    const active = (rows ?? []).filter((r) => r.status === "active");
    // All-Access wins over per-app
    const bundle = active.find((r) => r.app === "all_access");
    const direct = active.find((r) => r.app === data.app);
    const winner = bundle ?? direct;

    if (!winner) {
      return {
        app: data.app,
        tier: "free",
        status: "pending",
        currentPeriodEnd: null,
        hasAccess: false,
      };
    }

    return {
      app: data.app,
      tier: winner.tier as Entitlement["tier"],
      status: winner.status as Entitlement["status"],
      currentPeriodEnd: winner.current_period_end,
      hasAccess: true,
    };
  });
