import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { deriveFeatures, logEntitlementCheck, type Tier } from "@/lib/entitlement.functions";
import { FREE_PROMOTION_ACTIVE, FREE_PROMOTION_TIER } from "@/lib/promotion";
import {
  compareSubscriptionShadow,
  fetchSovereignSubscriptionRows,
  fetchSubscriptionRows,
  getBackendProvider,
  recordSovereignIdentityObservation,
  resolveBearerUserId,
} from "@/lib/backend-provider.server";

/**
 * Public entitlement endpoint for spoke apps.
 *
 * GET /api/public/entitlement?app=<app_key>
 *   Authorization: Bearer <supabase_access_token>
 *
 * Returns the caller's effective tier for the requested app. An active
 * `all_access` bundle wins over per-app subscriptions.
 *
 * CORS is open (*) so spokes on any subdomain can call it. The endpoint is
 * read-only and requires a valid Supabase access token, so no PII leaks.
 */

const AppSchema = z.enum([
  "epublisher",
  "creative_studio",
  "sync_vision",
  "youtube_optimizer",
  "all_access",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Short private cache so spokes can hit this endpoint freely without
      // hammering the DB. 60s matches the audit's recommendation.
      "Cache-Control": "private, max-age=60",
      ...CORS,
      ...extraHeaders,
    },
  });
}

export const Route = createFileRoute("/api/public/entitlement")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request }) => {
        const sourceIp = request.headers.get("x-forwarded-for") ?? request.headers.get("cf-connecting-ip");
        const userAgent = request.headers.get("user-agent");
        const url = new URL(request.url);
        const appParam = url.searchParams.get("app");
        const parsed = AppSchema.safeParse(appParam);
        if (!parsed.success) {
          return json({ error: "Invalid or missing `app` query parameter" }, 400);
        }
        const app = parsed.data;

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          void logEntitlementCheck({ userId: null, app, tier: null, status: "unauthorized", source: null, error: "missing_bearer", sourceIp, userAgent });
          return json({ error: "Missing Bearer token" }, 401);
        }
        const token = authHeader.slice(7).trim();
        if (!token) {
          void logEntitlementCheck({ userId: null, app, tier: null, status: "unauthorized", source: null, error: "empty_bearer", sourceIp, userAgent });
          return json({ error: "Missing Bearer token" }, 401);
        }

        let userId: string | null = null;
        try {
          userId = await resolveBearerUserId(token);
        } catch {
          return json({ error: "Server misconfigured" }, 500);
        }
        if (!userId) {
          void logEntitlementCheck({ userId: null, app, tier: null, status: "unauthorized", source: null, error: "invalid_token", sourceIp, userAgent });
          return json({ error: "Invalid or expired token" }, 401);
        }

        if (FREE_PROMOTION_ACTIVE) {
          const checkedAt = new Date().toISOString();
          void logEntitlementCheck({
            userId,
            app,
            tier: FREE_PROMOTION_TIER,
            status: "active",
            source: "trial",
            sourceIp,
            userAgent,
          });
          return json({
            ok: true,
            app,
            userId,
            tier: FREE_PROMOTION_TIER,
            status: "active",
            source: "trial",
            expiresAt: null,
            features: deriveFeatures(app, FREE_PROMOTION_TIER),
            checkedAt,
            hasAccess: true,
            currentPeriodEnd: null,
            promotionActive: true,
          });
        }
        let rows;
        try {
          rows = await fetchSubscriptionRows(token, userId, [app, "all_access"]);
        } catch (error) {
          const message = error instanceof Error ? error.message : "provider lookup failed";
          console.error("entitlement query failed:", message);
          void logEntitlementCheck({ userId, app, tier: "free", status: "inactive", source: "none", error: message, sourceIp, userAgent });
          return json({ error: "Lookup failed" }, 500);
        }

        if (process.env.RONS_IDENTITY_SHADOW === "1" && getBackendProvider() === "supabase") {
          try {
            await recordSovereignIdentityObservation(userId);
          } catch {
            console.info("[RONS identity shadow]", { unavailable: true });
          }
        }

        if (process.env.RONS_ENTITLEMENT_SHADOW === "1" && getBackendProvider() === "supabase") {
          try {
            const sovereignRows = await fetchSovereignSubscriptionRows(userId, [app, "all_access"]);
            console.info("[RONS entitlement shadow]", {
              app,
              ...compareSubscriptionShadow(rows, sovereignRows),
            });
          } catch {
            console.info("[RONS entitlement shadow]", { app, unavailable: true });
          }
        }

        const active = rows.filter((r) => r.status === "active");
        const bundle = active.find((r) => r.app === "all_access");
        const direct = active.find((r) => r.app === app);
        const winner = bundle ?? direct;
        const checkedAt = new Date().toISOString();

        if (!winner) {
          void logEntitlementCheck({ userId, app, tier: "free", status: "inactive", source: "none", sourceIp, userAgent });
          return json({
            ok: true,
            app,
            userId,
            tier: "free",
            status: "inactive",
            source: "none",
            expiresAt: null,
            features: deriveFeatures(app, "free"),
            checkedAt,
            hasAccess: false,
            currentPeriodEnd: null,
          });
        }

        const tier = winner.tier as Tier;
        const source = winner.app === "all_access" ? "all_access" : "direct";
        void logEntitlementCheck({ userId, app, tier, status: winner.status, source, sourceIp, userAgent });

        return json({
          ok: true,
          app,
          userId,
          tier,
          status: winner.status,
          source,
          expiresAt: winner.current_period_end,
          features: deriveFeatures(app, tier),
          checkedAt,
          hasAccess: true,
          currentPeriodEnd: winner.current_period_end,
        });
      },
    },
  },
});
