import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, logAudit, verifyRopRequest } from "@/lib/rop/hmac.server";
import { AppliedSchema, parseIngestBody } from "@/lib/rop/ingest-schemas";

const OUTCOME_WINDOW_MS = 24 * 60 * 60 * 1000;

export const Route = createFileRoute("/api/public/rop/ingest-applied")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        const result = parseIngestBody(AppliedSchema, verified.rawBody);
        if (!result.ok) {
          return jsonResponse(
            { ok: false, error: result.error, code: result.code, issues: result.issues },
            result.status,
          );
        }
        const p = result.data;


        // Resolve hub_suggestion_id
        let hubSuggestionId = p.hub_suggestion_id ?? null;
        if (!hubSuggestionId) {
          const { data } = await supabaseAdmin
            .from("hub_suggestions")
            .select("id")
            .eq("app_id", verified.app.id)
            .eq("evidence->>local_id", p.local_id)
            .maybeSingle();
          hubSuggestionId = data?.id ?? null;
        }

        // Upsert tunable (app_id, key)
        const { error: tunErr } = await supabaseAdmin
          .from("hub_tunables")
          .upsert(
            {
              app_id: verified.app.id,
              key: p.target_key,
              value: (p.value_now ?? null) as never,
              applied_from: hubSuggestionId,
              applied_at: p.occurred_at ?? new Date().toISOString(),
            },
            { onConflict: "app_id,key" },
          );
        if (tunErr) console.error("[rop] tunable upsert failed", tunErr);

        // Update suggestion status — requires admin_note per lifecycle guard.
        if (hubSuggestionId) {
          const note = p.action === "applied"
            ? `Spoke app applied ${p.target_key}`
            : `Spoke app reverted ${p.target_key}`;
          const { error: sugErr } = await supabaseAdmin
            .from("hub_suggestions")
            .update({ status: p.action, admin_note: note })
            .eq("id", hubSuggestionId);
          if (sugErr) console.error("[rop] suggestion status update failed", sugErr);
        }

        // Outcome row on apply
        if (p.action === "applied" && hubSuggestionId) {
          const start = p.occurred_at ?? new Date().toISOString();
          const end = new Date(new Date(start).getTime() + OUTCOME_WINDOW_MS).toISOString();
          const { data: existing } = await supabaseAdmin
            .from("hub_outcomes")
            .select("id")
            .eq("suggestion_id", hubSuggestionId)
            .eq("verdict", "inconclusive")
            .maybeSingle();
          if (!existing) {
            await supabaseAdmin.from("hub_outcomes").insert({
              suggestion_id: hubSuggestionId,
              app_id: verified.app.id,
              metric: p.metric ?? "duration_ms",
              window_start: start,
              window_end: end,
              notes: `prior=${JSON.stringify(p.value_prior ?? null)} now=${JSON.stringify(p.value_now ?? null)}`,
            });
          }
        }

        await logAudit(verified.app.id, `tunable.${p.action}`, {
          local_id: p.local_id,
          hub_suggestion_id: hubSuggestionId,
          target_key: p.target_key,
        });
        return jsonResponse({ ok: true, hub_suggestion_id: hubSuggestionId }, 202);
      },
    },
  },
});
