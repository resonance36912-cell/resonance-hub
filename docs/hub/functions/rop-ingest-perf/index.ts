// =====================================================================
// ROP Hub — rop-ingest-perf
// Target path: supabase/functions/rop-ingest-perf/index.ts
// =====================================================================
// Accepts a batch of telemetry events from a registered app and writes
// them into hub_perf_events.
//
// Request body:
//   {
//     "events": [
//       {
//         "event_type": "render_job.completed",
//         "scope": "storyboard",
//         "metric": "duration_ms",
//         "value_num": 12450,
//         "value_text": null,
//         "tags": { "provider": "wan25", "scene": 3 },
//         "client_ts": "2026-06-21T01:23:45.000Z"
//       },
//       ...
//     ]
//   }
//
// Limits: 500 events per call, 1 MB total body.

import { z } from "https://esm.sh/zod@3.23.8";
import {
  corsHeaders,
  jsonResponse,
  verifyRopRequest,
} from "../_shared/rop-verify.ts";
import { admin, auditEvent, getAppById, getAppSecret } from "../_shared/rop-lookups.ts";

const PerfEvent = z.object({
  event_type: z.string().min(1).max(120),
  scope: z.string().max(120).nullish(),
  metric: z.string().max(120).nullish(),
  value_num: z.number().finite().nullish(),
  value_text: z.string().max(2000).nullish(),
  tags: z.record(z.unknown()).default({}),
  client_ts: z.string().datetime(),
});

const Body = z.object({
  events: z.array(PerfEvent).min(1).max(500),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "method_not_allowed" }, 405);

  const verified = await verifyRopRequest(req, getAppById, getAppSecret);
  if (!verified.ok) return jsonResponse({ error: verified.error }, verified.status);

  const parsed = Body.safeParse(verified.body);
  if (!parsed.success) {
    return jsonResponse(
      { error: "invalid_body", detail: parsed.error.flatten() },
      400,
    );
  }

  const rows = parsed.data.events.map((e) => ({
    app_id: verified.appId,
    event_type: e.event_type,
    scope: e.scope ?? null,
    metric: e.metric ?? null,
    value_num: e.value_num ?? null,
    value_text: e.value_text ?? null,
    tags: e.tags,
    client_ts: e.client_ts,
  }));

  const { error } = await admin.from("hub_perf_events").insert(rows);
  if (error) {
    console.error("[rop-ingest-perf] insert failed", error);
    return jsonResponse({ error: "insert_failed", detail: error.message }, 500);
  }

  // Best-effort audit (don't fail ingest if audit insert errors)
  auditEvent({
    appId: verified.appId,
    actorKind: "app",
    eventType: "perf.ingested",
    entityType: "hub_perf_events",
    payload: { count: rows.length },
  }).catch(() => {});

  return jsonResponse({ ok: true, accepted: rows.length });
});
