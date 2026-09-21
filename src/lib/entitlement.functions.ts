import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireRonsAuth, resolveRonsRequestCredential } from "@/lib/rons-auth-middleware";
import { fetchSubscriptionRows, writeEntitlementAudit } from "@/lib/backend-provider.server";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION_TIER } from "@/lib/promotion";

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

const ENTITLEMENT_CACHE_TTL_MS = 60_000;
const entitlementCache = new Map<string, { rows: Awaited<ReturnType<typeof fetchSubscriptionRows>>; expiresAt: number }>();
const entitlementInflight = new Map<string, Promise<Awaited<ReturnType<typeof fetchSubscriptionRows>>>>();
const entitlementCacheKey = (userId: string, app: AppKey) => `${userId}:${app}`;

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
      return { posters: isPaid, videos: isPro, teamSeats: isBusiness, whiteLabel: isBusiness };
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
 * Fire-and-forget audit write. Never throws into the request path —
 * a failed log must NOT cause the entitlement check itself to fail.
 */
export async function logEntitlementCheck(args: {
  userId: string | null;
  app: string;
  tier: string | null;
  status: string;
  source: string | null;
  error?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await writeEntitlementAudit({
      user_id: args.userId,
      app: args.app,
      tier: args.tier,
      status: args.status,
      source: args.source,
      error: args.error ?? null,
      source_ip: args.sourceIp ?? null,
      user_agent: args.userAgent ?? null,
    });
  } catch (err) {
    console.error("entitlement_log insert failed:", err);
  }
}

export const getEntitlement = createServerFn({ method: "POST" })
  .middleware([requireRonsAuth])
  .validator((input: { app: AppKey }) => ({ app: AppSchema.parse(input.app) }))
  .handler(async ({ data, context }): Promise<Entitlement> => {
    const { userId } = context;
    const checkedAt = new Date().toISOString();
    let req: ReturnType<typeof getRequest> | null = null;
    try {
      req = getRequest();
    } catch {
      req = null;
    }
    const sourceIp = req?.headers.get("x-forwarded-for") ?? null;
    const userAgent = req?.headers.get("user-agent") ?? null;

    if (FREE_PROMOTION_ACTIVE) {
      void logEntitlementCheck({
        userId,
        app: data.app,
        tier: FREE_PROMOTION_TIER,
        status: "active",
        source: "trial",
        sourceIp,
        userAgent,
      });
      return {
        ok: true,
        app: data.app,
        userId,
        tier: FREE_PROMOTION_TIER,
        status: "active",
        source: "trial",
        expiresAt: null,
        features: deriveFeatures(data.app, FREE_PROMOTION_TIER),
        checkedAt,
        hasAccess: true,
        currentPeriodEnd: null,
      };
    }

    const cacheKey = entitlementCacheKey(userId, data.app);
    const cached = entitlementCache.get(cacheKey);
    let rows: Awaited<ReturnType<typeof fetchSubscriptionRows>>;
    if (cached && cached.expiresAt > Date.now()) {
      rows = cached.rows;
    } else {
      const inflight = entitlementInflight.get(cacheKey);
      const lookup = inflight ?? (async () => {
        const credential = req ? resolveRonsRequestCredential(req) : null;
        if (!credential) throw new Error("Authenticated request credential unavailable");
        const fetched = await fetchSubscriptionRows(credential, userId, [data.app, "all_access"]);
        entitlementCache.set(cacheKey, { rows: fetched, expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS });
        return fetched;
      })();
      if (!inflight) entitlementInflight.set(cacheKey, lookup);
      try {
        rows = await lookup;
      } catch (error) {
      const message = error instanceof Error ? error.message : "provider lookup failed";
      console.error("getEntitlement query failed:", message);
      void logEntitlementCheck({
        userId,
        app: data.app,
        tier: "free",
        status: "inactive",
        source: "none",
        error: message,
        sourceIp,
        userAgent,
      });
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
      } finally {
        if (!inflight && entitlementInflight.get(cacheKey) === lookup) entitlementInflight.delete(cacheKey);
      }
    }

    const active = (rows ?? []).filter((r) => r.status === "active");
    const bundle = active.find((r) => r.app === "all_access");
    const direct = active.find((r) => r.app === data.app);
    const winner = bundle ?? direct;

    if (!winner) {
      void logEntitlementCheck({
        userId,
        app: data.app,
        tier: "free",
        status: "inactive",
        source: "none",
        sourceIp,
        userAgent,
      });
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

    const source: EntitlementSource = winner === bundle ? "all_access" : "direct";
    const tier = winner.tier as Tier;

    void logEntitlementCheck({
      userId,
      app: data.app,
      tier,
      status: winner.status,
      source,
      sourceIp,
      userAgent,
    });

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
