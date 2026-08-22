// =====================================================================
// ROP Hub — rop-ingest-suggestion
// Target path: supabase/functions/rop-ingest-suggestion/index.ts
// =====================================================================
// An app forwards a locally-generated suggestion (rule-based or AI)
// upstream to the Hub for visibility and potential broadcast.
//
// Request body:
//   {
//     "external_id"     : "syncvision:opt-...",  // for idempotency
//     "source"          : "rule" | "ai",
//     "title"           : "...",
//     "rationale"       : "...",
//     "target_scope"    : "storyboard.wan25.concurrency",
//     "proposed_change" : { "tunable_key": "...", "from": 5, "to": 3 },
//     "evidence"        : { ... metrics, event refs ... },
//     "confidence"      : 0.0..1.0
//   }
//
// Behaviour:
//   - Upsert on (app_id, evidence->>'external_id') so retries are safe.
//   - Status starts as 'pending'; Hub admins approve/apply via UI.

import { z } from "https://esm.sh/zod@3.23.8";
import {
  corsHeaders,
  jsonResponse,
  verifyRopRequest,
} from "../_shared/rop-verify.ts";
import { admin, auditEvent, getAppById, getAppSecret } from "../_shared/rop-lookups.ts";

const Body = z.object({
  external_id: z.string().min(1).max(200),
  source: z.enum(["rule", "ai"]),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(4000),
  target_scope: z.string().min(1).max(200),
  proposed_change: z.record(z.unknown()),
  evidence: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).nullish(),
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
  const b = parsed.data;
  const evidence = { ...b.evidence, external_id: b.external_id };

  // Idempotency: look up existing row by (app_id, evidence->>'external_id').
  const { data: existing, error: lookupErr } = await admin
    .from("hub_suggestions")
    .select("id, status")
    .eq("app_id", verified.appId)
    .filter("evidence->>external_id", "eq", b.external_id)
    .maybeSingle();

  if (lookupErr) {
    return jsonResponse({ error: "lookup_failed", detail: lookupErr.message }, 500);
  }

  if (existing) {
    return jsonResponse({ ok: true, id: existing.id, status: existing.status, deduped: true });
  }

  const { data, error } = await admin
    .from("hub_suggestions")
    .insert({
      app_id: verified.appId,
      source: b.source,
      status: "pending",
      title: b.title,
      rationale: b.rationale,
      target_scope: b.target_scope,
      proposed_change: b.proposed_change,
      evidence,
      confidence: b.confidence ?? null,
    })
    .select("id, status")
    .single();

  if (error) {
    return jsonResponse({ error: "insert_failed", detail: error.message }, 500);
  }

  auditEvent({
    appId: verified.appId,
    actorKind: "app",
    eventType: "suggestion.proposed",
    entityType: "hub_suggestions",
    entityId: data.id,
    payload: { source: b.source, target_scope: b.target_scope },
  }).catch(() => {});

  return jsonResponse({ ok: true, id: data.id, status: data.status });
});
