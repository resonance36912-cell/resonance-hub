/**
 * GET /api/public/usage/wallet?app=<app_key>
 *   Authorization: Bearer <supabase_access_token>
 *
 * Returns the caller's credit wallet balance for a single app. Spokes use this
 * to render "You have N credits" and to gate expensive UI affordances before
 * ever calling reserve. Reads only — never mutates.
 *
 * 200 → { ok: true, app, userId, balance, walletId, updatedAt }
 *       (balance = 0 and walletId = null if no wallet row exists yet)
 * 400 → { error: "invalid_input", ... }
 * 401 → { error: "unauthorized" }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateBearer } from "@/lib/bearer-auth.server";
import { USAGE_APP_KEYS, USAGE_CORS, usageJson } from "@/lib/usage-api";

const AppSchema = z.enum(USAGE_APP_KEYS);

export const Route = createFileRoute("/api/public/usage/wallet")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: USAGE_CORS }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = AppSchema.safeParse(url.searchParams.get("app"));
        if (!parsed.success) {
          return usageJson({ error: "invalid_input", message: "Invalid or missing `app`" }, 400);
        }
        const app = parsed.data;

        const auth = await authenticateBearer(request, USAGE_CORS);
        if (auth instanceof Response) return auth;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("credit_wallets")
          .select("id, balance, updated_at")
          .eq("user_id", auth.userId)
          .eq("app", app)
          .maybeSingle();

        if (error) {
          console.error("[usage/wallet] lookup failed:", error);
          return usageJson({ error: "lookup_failed" }, 500);
        }

        return usageJson({
          ok: true,
          app,
          userId: auth.userId,
          balance: data?.balance ?? 0,
          walletId: data?.id ?? null,
          updatedAt: data?.updated_at ?? null,
        });
      },
    },
  },
});
