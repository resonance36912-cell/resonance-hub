import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, logAudit, verifyRopRequest } from "@/lib/rop/hmac.server";

const AppliedSchema = z.object({
  local_id: z.string().min(1).max(120),
  hub_suggestion_id: z.string().uuid().optional(),
  action: z.enum(["applied", "reverted"]),
  target_key: z.string().min(1).max(160),
  value_now: z.unknown().optional(),
  value_prior: z.unknown().optional(),
  actor_user_id: z.string().max(160).optional(),
  occurred_at: z.string().min(10).optional(),
});

export const Route = createFileRoute("/api/public/rop/ingest-applied")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        let p: z.infer<typeof AppliedSchema>;
        try {
          p = AppliedSchema.parse(JSON.parse(verified.rawBody || "{}"));
        } catch (e) {
          return jsonResponse({ ok: false, error: `Invalid payload: ${(e as Error).message}` }, 400);
        }

        // Look up hub suggestion id (either provided, or via app_id+local_id)
        let hubSuggestionId = p.hub_suggestion_id ?? null;
        if (!hubSuggestionId) {
          const { data } = await supabaseAdmin
            .from("hub_suggestions")
            .select("id")
            .eq("app_id", verified.app.id)
            .eq("local_id", p.local_id)
            .maybeSingle();
          hubSuggestionId = data?.id ?? null;
        }

        // Update tunables row
        const { error: tunErr } = await supabaseAdmin
          .from("hub_tunables")
          .upsert(
            {
              app_id: verified.app.id,
              target_key: p.target_key,
              value_now: (p.value_now ?? null) as never,
              value_prior: (p.value_prior ?? null) as never,
              actor_user_id: p.actor_user_id ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "app_id,target_key" },
          );
        if (tunErr) console.error("[rop] tunable upsert failed", tunErr);

        // Update suggestion status
        if (hubSuggestionId) {
          await supabaseAdmin
            .from("hub_suggestions")
            .update({ status: p.action === "applied" ? "applied" : "reverted" })
            .eq("id", hubSuggestionId);
        }

        // Record outcome baseline when applied
        if (p.action === "applied" && hubSuggestionId) {
          const { data: existing } = await supabaseAdmin
            .from("hub_outcomes")
            .select("id")
            .eq("hub_suggestion_id", hubSuggestionId)
            .is("measured_at", null)
            .maybeSingle();
          if (!existing) {
            await supabaseAdmin.from("hub_outcomes").insert({
              hub_suggestion_id: hubSuggestionId,
              app_id: verified.app.id,
              baseline: {
                target_key: p.target_key,
                value_prior: p.value_prior ?? null,
                value_now: p.value_now ?? null,
                captured_at: new Date().toISOString(),
              } as never,
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
