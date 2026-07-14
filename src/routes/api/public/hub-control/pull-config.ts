// Spoke fallback pull: consolidated config (flags, tunables, tier gates,
// kill-switches, approved broadcast suggestions). Signed with the same
// per-app HMAC scheme as the rest of ROP.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, verifyRopRequest } from "@/lib/rop/hmac.server";

export const Route = createFileRoute("/api/public/hub-control/pull-config")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        const app = verified.app;
        const url = new URL(request.url);
        const since = url.searchParams.get("since") ?? "1970-01-01T00:00:00Z";

        const [flags, tunables, products, suggestions] = await Promise.all([
          supabaseAdmin
            .from("feature_flags")
            .select("key, value, description, updated_at")
            .or(`app_id.is.null,app_id.eq.${app.id}`),
          supabaseAdmin
            .from("hub_tunables")
            .select("key, value, updated_at")
            .or(`app_id.is.null,app_id.eq.${app.id}`),
          supabaseAdmin
            .from("products")
            .select("id, product_key, product_type, price_cents, currency, billing_interval, included_credits, status, metadata")
            .eq("status", "active"),
          supabaseAdmin
            .from("hub_suggestions")
            .select("id, source, title, target_scope, proposed_change, evidence, updated_at, app_id, broadcast")
            .eq("status", "approved")
            .or(`app_id.is.null,app_id.eq.${app.id}`)
            .gt("updated_at", since)
            .order("updated_at", { ascending: true })
            .limit(200),
        ]);

        return jsonResponse({
          ok: true,
          as_of: new Date().toISOString(),
          app: { id: app.id, slug: app.slug },
          feature_flags: flags.data ?? [],
          tunables: tunables.data ?? [],
          tier_catalog: products.data ?? [],
          suggestions: suggestions.data ?? [],
        });
      },
    },
  },
});
