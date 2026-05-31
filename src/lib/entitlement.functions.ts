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
export type Tier = "free" | "starter" | "creator" | "pro" | "business" | "all_access";
export type EntitlementStatus = "active" | "pending" | "past_due" | "cancelled" | "inactive";
export type EntitlementSource = "direct" | "all_access" | "admin_override" | "trial" | "none";

/** Per-app feature flags derived from (app, tier). Keep in sync with spoke apps. */
export type EntitlementFeatures = Record<string, boolean>;

export type Entitlement = {
  ok: boolean;
  app: AppKey;
  userId: string | null;
  tier: Tier;
  status: EntitlementStatus;
  source: EntitlementSource;
  expiresAt: string | null;
  features: EntitlementFeatures;
  checkedAt: string;
  // Backwards-compat aliases for legacy spoke-app callers:
  hasAccess: boolean;
  currentPeriodEnd: string | null;
};

/**
 * Canonical feature map. Spokes can read either `features.<key>` or
 * derive their own from `tier`. Keys are stable; never remove without
 * coordinating spoke releases.
 */
export function deriveFeatures(app: AppKey, tier: Tier): EntitlementFeatures {
  const isPro = tier === "pro" || tier === "business" || tier === "all_access";
  const isBusiness = tier === "business";
  const isPaid = tier !== "free";

  switch (app) {
    case "epublisher":
      return {
        watermarkRemoved: isPaid,
        audioNarration: tier === "creator" || isPro,
        unlimitedProjects: isPro,
        customVoices: tier === "pro" || isBusiness || tier === "all_access",
        teamSeats: isBusiness,
      };
    case "creative_studio":
      return {
        posters: isPaid,
        videos: isPro,
        teamSeats: isBusiness,
        whiteLabel: isBusiness,
      };
    case "sync_vision":
      return {
        storyboards: isPaid,
        hdRenders: isPro,
        characterPerformance: isPro,
        priorityQueue: isBusiness,
      };
    case "youtube_optimizer":
      return {
        channelAudits: isPaid || tier === "free",
        thumbnails: isPaid,
        growthRoadmap: isPro,
        teamSeats: isBusiness,
      };
    case "all_access":
      return { allAccess: tier === "all_access" };
  }
}

/**
 * Resolve a user's effective tier for a given app.
 * If the user holds an active `all_access` bundle, that wins.
 *
 * Returns the canonical Entitlement contract. Backwards-compat fields
 * (`hasAccess`, `currentPeriodEnd`) are populated for legacy spoke callers.
 */
export const getEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { app: AppKey }) => ({ app: AppSchema.parse(input.app) }))
  .handler(async ({ data, context }): Promise<Entitlement> => {
    const { supabase, userId } = context;
    const checkedAt = new Date().toISOString();

    const { data: rows, error } = await supabase
      .from("subscriptions")
      .select("app,tier,status,current_period_end")
      .eq("user_id", userId)
      .in("app", [data.app, "all_access"]);

    if (error) {
      console.error("getEntitlement query failed:", error);
      return {
        ok: false,
        app: data.app,
        userId,
        tier: "free",
        status: "inactive",
        source: "none",
        expiresAt: null,
        features: deriveFeatures(data.app, "free"),
        checkedAt,
        hasAccess: false,
        currentPeriodEnd: null,
      };
    }

    const active = (rows ?? []).filter((r) => r.status === "active");
    const bundle = active.find((r) => r.app === "all_access");
    const direct = active.find((r) => r.app === data.app);
    const winner = bundle ?? direct;

    if (!winner) {
      return {
        ok: true,
        app: data.app,
        userId,
        tier: "free",
        status: "inactive",
        source: "none",
        expiresAt: null,
        features: deriveFeatures(data.app, "free"),
        checkedAt,
        hasAccess: false,
        currentPeriodEnd: null,
      };
    }

    const source: EntitlementSource =
      winner === bundle ? "all_access" : "direct";
    const tier = winner.tier as Tier;

    return {
      ok: true,
      app: data.app,
      userId,
      tier,
      status: winner.status as EntitlementStatus,
      source,
      expiresAt: winner.current_period_end,
      features: deriveFeatures(data.app, tier),
      checkedAt,
      hasAccess: true,
      currentPeriodEnd: winner.current_period_end,
    };
  });
