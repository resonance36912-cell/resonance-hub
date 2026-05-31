import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { deriveFeatures, type Tier } from "@/lib/entitlement.functions";

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
        const url = new URL(request.url);
        const appParam = url.searchParams.get("app");
        const parsed = AppSchema.safeParse(appParam);
        if (!parsed.success) {
          return json({ error: "Invalid or missing `app` query parameter" }, 400);
        }
        const app = parsed.data;

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return json({ error: "Missing Bearer token" }, 401);
        }
        const token = authHeader.slice(7).trim();
        if (!token) return json({ error: "Missing Bearer token" }, 401);

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json({ error: "Server misconfigured" }, 500);
        }

        // Authenticated client (RLS applies as the calling user)
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claimsData?.claims?.sub) {
          return json({ error: "Invalid or expired token" }, 401);
        }
        const userId = claimsData.claims.sub as string;

        const { data: rows, error } = await supabase
          .from("subscriptions")
          .select("app,tier,status,current_period_end")
          .eq("user_id", userId)
          .in("app", [app, "all_access"]);

        if (error) {
          console.error("entitlement query failed:", error);
          return json({ error: "Lookup failed" }, 500);
        }

        const active = (rows ?? []).filter((r) => r.status === "active");
        const bundle = active.find((r) => r.app === "all_access");
        const direct = active.find((r) => r.app === app);
        const winner = bundle ?? direct;
        const checkedAt = new Date().toISOString();

        if (!winner) {
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
            // legacy aliases
            hasAccess: false,
            currentPeriodEnd: null,
          });
        }

        const tier = winner.tier as Tier;
        const source = winner.app === "all_access" ? "all_access" : "direct";

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
          // legacy aliases
          hasAccess: true,
          currentPeriodEnd: winner.current_period_end,
        });
      },
    },
  },
});
