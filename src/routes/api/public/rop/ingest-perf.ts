import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, logAudit, verifyRopRequest } from "@/lib/rop/hmac.server";

const EventSchema = z.object({
  step: z.string().min(1).max(120),
  action: z.string().min(1).max(120),
  provider: z.string().max(120).nullable().optional(),
  duration_ms: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable().optional(),
  status: z.string().max(40).nullable().optional(),
  error_code: z.string().max(120).nullable().optional(),
  occurred_at: z.string().min(10),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PayloadSchema = z.object({ events: z.array(EventSchema).min(1).max(500) });

export const Route = createFileRoute("/api/public/rop/ingest-perf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const verified = await verifyRopRequest(request);
        if (!verified.ok) return jsonResponse({ ok: false, error: verified.error }, verified.status);

        let parsed: z.infer<typeof PayloadSchema>;
        try {
          parsed = PayloadSchema.parse(JSON.parse(verified.rawBody || "{}"));
        } catch (e) {
          return jsonResponse({ ok: false, error: `Invalid payload: ${(e as Error).message}` }, 400);
        }

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
