import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, logAudit, verifyRopRequest } from "@/lib/rop/hmac.server";

const SuggestionSchema = z.object({
  local_id: z.string().min(1).max(120),
  source: z.enum(["rule", "ai", "cross_app", "hub"]),
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

        const { data, error } = await supabaseAdmin
          .from("hub_suggestions")
          .upsert(
            {
              app_id: verified.app.id,
              local_id: p.local_id,
              source: p.source,
              category: p.category ?? null,
              title: p.title,
              rationale: p.rationale ?? null,
              evidence: (p.evidence ?? {}) as any,
              target_key: p.target_key ?? null,
              current_value: (p.current_value ?? null) as never,
              suggested_value: (p.suggested_value ?? null) as never,
            },
            { onConflict: "app_id,local_id" },
          )
          .select("id")
          .maybeSingle();
        if (error) {
          console.error("[rop] suggestion upsert failed", error);
          return jsonResponse({ ok: false, error: "Upsert failed" }, 500);
        }
        await logAudit(verified.app.id, "suggestion.ingest", { local_id: p.local_id, hub_id: data?.id });
        return jsonResponse({ ok: true, hub_suggestion_id: data?.id }, 202);
      },
    },
  },
});
