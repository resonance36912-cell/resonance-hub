import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, logAudit, verifyRopRequest } from "@/lib/rop/hmac.server";
import { PerfPayloadSchema, parseIngestBody } from "@/lib/rop/ingest-schemas";

export const Route = createFileRoute("/api/public/rop/ingest-perf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        const result = parseIngestBody(PerfPayloadSchema, verified.rawBody);
        if (!result.ok) {
          return jsonResponse(
            { ok: false, error: result.error, code: result.code, issues: result.issues },
            result.status,
          );
        }
        const parsed = result.data;


        const rows = parsed.events.map((ev) => ({
          app_id: verified.app.id,
          event_type: `${ev.step}.${ev.action}`,
          scope: ev.step,
          metric: ev.duration_ms != null ? "duration_ms" : null,
          value_num: ev.duration_ms ?? null,
          value_text: ev.status ?? null,
          tags: {
            action: ev.action,
            provider: ev.provider ?? null,
            status: ev.status ?? null,
            error_code: ev.error_code ?? null,
            ...(ev.metadata ?? {}),
          } as never,
          client_ts: ev.occurred_at,
        }));

        const { error } = await supabaseAdmin.from("hub_perf_events").insert(rows);
        if (error) {
          console.error("[rop] perf insert failed", error);
          return jsonResponse({ ok: false, error: "Insert failed" }, 500);
        }
        await logAudit(verified.app.id, "perf.ingest", { count: rows.length });
        return jsonResponse({ ok: true, accepted: rows.length }, 202);
      },
    },
  },
});
