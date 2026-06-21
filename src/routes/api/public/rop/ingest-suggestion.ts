import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, logAudit, verifyRopRequest } from "@/lib/rop/hmac.server";

const SuggestionSchema = z.object({
  local_id: z.string().min(1).max(120),
  source: z.enum(["rule", "ai", "cross_app", "manual"]),
  category: z.string().max(80).optional(),
  title: z.string().min(1).max(280),
  rationale: z.string().max(4000).optional(),
  evidence: z.record(z.unknown()).optional(),
  target_key: z.string().max(160).optional(),
  current_value: z.unknown().optional(),
  suggested_value: z.unknown().optional(),
});

export const Route = createFileRoute("/api/public/rop/ingest-suggestion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        let p: z.infer<typeof SuggestionSchema>;
        try {
          p = SuggestionSchema.parse(JSON.parse(verified.rawBody || "{}"));
        } catch (e) {
          return jsonResponse({ ok: false, error: `Invalid payload: ${(e as Error).message}` }, 400);
        }

        // Idempotency on (app_id, evidence->>'local_id'): look up first.
        const { data: existing } = await supabaseAdmin
          .from("hub_suggestions")
          .select("id")
          .eq("app_id", verified.app.id)
          .eq("evidence->>local_id", p.local_id)
          .maybeSingle();

        const evidence = { ...(p.evidence ?? {}), local_id: p.local_id, category: p.category ?? null };
        const row = {
          app_id: verified.app.id,
          source: p.source,
          title: p.title,
          rationale: p.rationale ?? "",
          target_scope: p.target_key ?? "unspecified",
          proposed_change: {
            target_key: p.target_key ?? null,
            current_value: p.current_value ?? null,
            suggested_value: p.suggested_value ?? null,
          } as never,
          evidence: evidence as never,
        };

        let hubId: string | undefined;
        if (existing?.id) {
          const { data, error } = await supabaseAdmin
            .from("hub_suggestions")
            .update(row)
            .eq("id", existing.id)
            .select("id")
            .maybeSingle();
          if (error) {
            console.error("[rop] suggestion update failed", error);
            return jsonResponse({ ok: false, error: "Update failed" }, 500);
          }
          hubId = data?.id;
        } else {
          const { data, error } = await supabaseAdmin
            .from("hub_suggestions")
            .insert(row)
            .select("id")
            .maybeSingle();
          if (error) {
            console.error("[rop] suggestion insert failed", error);
            return jsonResponse({ ok: false, error: "Insert failed" }, 500);
          }
          hubId = data?.id;
        }

        await logAudit(verified.app.id, "suggestion.ingest", { local_id: p.local_id, hub_id: hubId });
        return jsonResponse({ ok: true, hub_suggestion_id: hubId }, 202);
      },
    },
  },
});
