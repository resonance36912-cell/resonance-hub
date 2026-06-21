import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, verifyRopRequest } from "@/lib/rop/hmac.server";

export const Route = createFileRoute("/api/public/rop/pull-broadcasts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        const url = new URL(request.url);
        const since = url.searchParams.get("since") ?? "1970-01-01T00:00:00Z";

        const { data, error } = await supabaseAdmin
          .from("hub_suggestions")
          .select(
            "id, source, category, title, rationale, evidence, target_key, current_value, suggested_value, updated_at, app_id",
          )
          .eq("broadcast", true)
          .or(`app_id.is.null,app_id.eq.${verified.app.id}`)
          .gt("updated_at", since)
          .order("updated_at", { ascending: true })
          .limit(200);

        if (error) {
          console.error("[rop] broadcast pull failed", error);
          return jsonResponse({ ok: false, error: "Query failed" }, 500);
        }

        const broadcasts = (data ?? []).map((r) => ({
          hub_id: r.id,
          source: r.source,
          category: r.category,
          title: r.title,
          rationale: r.rationale,
          evidence: r.evidence,
          target_key: r.target_key,
          current_value: r.current_value,
          suggested_value: r.suggested_value,
          updated_at: r.updated_at,
        }));

        return jsonResponse({ ok: true, broadcasts, as_of: new Date().toISOString() });
      },
    },
  },
});
