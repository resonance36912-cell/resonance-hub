// =====================================================================
// ROP Hub — rop-ingest-applied
// Target path: supabase/functions/rop-ingest-applied/index.ts
// =====================================================================
// An app reports a lifecycle change for a suggestion it has acted on
// locally (applied, reverted, or rejected). The Hub updates the
// corresponding hub_suggestions row and, on 'applied', upserts
// hub_tunables so other apps can see the current state.
//
// Body:
//   {
//     "external_id" : "syncvision:opt-...", // matches the proposal payload
//     "status"      : "applied" | "reverted" | "rejected",
//     "admin_note"  : "Concurrency lowered after 3 timeouts/hr",
//     "tunable"     : { "key": "...", "value": <jsonb> }  // required when status='applied'
//   }

import { z } from "https://esm.sh/zod@3.23.8";
import {
  corsHeaders,
  jsonResponse,
  verifyRopRequest,
} from "../_shared/rop-verify.ts";
import { admin, auditEvent, getAppById, getAppSecret } from "../_shared/rop-lookups.ts";

const Body = z.object({
  external_id: z.string().min(1).max(200),
  status: z.enum(["applied", "reverted", "rejected"]),
  admin_note: z.string().min(1).max(2000),
  tunable: z
    .object({
      key: z.string().min(1).max(200),
      value: z.unknown(),
    })
    .optional(),
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

  if (b.status === "applied" && !b.tunable) {
    return jsonResponse({ error: "tunable_required_on_apply" }, 400);
  }

  // Find the originating suggestion row by external_id.
  const { data: sug, error: lookupErr } = await admin
    .from("hub_suggestions")
    .select("id")
    .eq("app_id", verified.appId)
    .filter("evidence->>external_id", "eq", b.external_id)
    .maybeSingle();

  if (lookupErr) {
    return jsonResponse({ error: "lookup_failed", detail: lookupErr.message }, 500);
  }
  if (!sug) {
    return jsonResponse({ error: "unknown_suggestion" }, 404);
  }

  // Update lifecycle (DB trigger enforces admin_note + stamps timestamps).
  const { error: updErr } = await admin
    .from("hub_suggestions")
    .update({ status: b.status, admin_note: b.admin_note })
    .eq("id", sug.id);

  if (updErr) {
    return jsonResponse({ error: "update_failed", detail: updErr.message }, 500);
  }

  // On 'applied' upsert the tunable so the broadcast view sees it.
  if (b.status === "applied" && b.tunable) {
    const { error: tunErr } = await admin
      .from("hub_tunables")
      .upsert(
        {
          app_id: verified.appId,
          key: b.tunable.key,
          value: b.tunable.value as never,
          applied_from: sug.id,
          applied_at: new Date().toISOString(),
        },
        { onConflict: "app_id,key" },
      );
    if (tunErr) {
      console.error("[rop-ingest-applied] tunable upsert failed", tunErr);
      // Don't fail the request — lifecycle change already persisted.
    }
  }

  auditEvent({
    appId: verified.appId,
    actorKind: "app",
    eventType: `suggestion.${b.status}`,
    entityType: "hub_suggestions",
    entityId: sug.id,
    payload: { admin_note: b.admin_note, tunable: b.tunable ?? null },
  }).catch(() => {});

  return jsonResponse({ ok: true, id: sug.id, status: b.status });
});
