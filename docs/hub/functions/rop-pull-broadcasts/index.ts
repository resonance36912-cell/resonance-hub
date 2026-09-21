// =====================================================================
// ROP Hub — rop-pull-broadcasts
// Target path: supabase/functions/rop-pull-broadcasts/index.ts
// =====================================================================
//
// Outbound feed: an app's publisher calls this every ~10 min to pull
// any broadcast-flagged suggestions + tunable recommendations from
// other apps in the workspace.
//
// Auth: same HMAC scheme as the ingest endpoints (POST with signed
// JSON body). GET is rejected because the body participates in the
// signature.
//
// Request body:
//   {
//     "since"  : "2026-06-21T00:00:00.000Z",  // optional, ISO
//     "limit"  : 100                          // optional, 1..500
//   }
//
// Response:
//   {
//     "ok": true,
//     "server_time": "2026-06-21T01:30:00.000Z",
//     "suggestions": [
//       {
//         "id": "uuid",
//         "source_app": { "id": "uuid", "slug": "creativestudio" } | null,
//         "source": "cross_app" | "ai" | "rule" | "manual",
//         "title": "...",
//         "rationale": "...",
//         "target_scope": "...",
//         "proposed_change": { ... },
//         "evidence": { ... },
//         "confidence": 0.83,
//         "applied_in_apps": ["syncvision", "creativestudio"],
//         "updated_at": "2026-06-21T01:25:00.000Z"
//       }
//     ],
//     "next_since": "2026-06-21T01:25:00.000Z"   // cursor for next poll
//   }
//
// Filter rules:
//   - `broadcast = true`
//   - `status IN ('approved','applied')`   (don't leak unreviewed drafts)
//   - exclude rows where `app_id = caller_app_id` (caller already has them)
//   - `updated_at > since` if provided
//   - max 500 rows; default 100; ordered by updated_at ASC for cursor stability

import { z } from "https://esm.sh/zod@3.23.8";
import {
  corsHeaders,
  jsonResponse,
  verifyRopRequest,
} from "../_shared/rop-verify.ts";
import { admin, auditEvent, getAppById, getAppSecret } from "../_shared/rop-lookups.ts";

const Body = z.object({
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

type SuggestionRow = {
  id: string;
  app_id: string | null;
  source: string;
  title: string;
  rationale: string;
  target_scope: string;
  proposed_change: unknown;
  evidence: unknown;
  confidence: number | null;
  updated_at: string;
  hub_apps: { id: string; slug: string } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "method_not_allowed" }, 405);

  const verified = await verifyRopRequest(req, getAppById, getAppSecret);
  if (!verified.ok) return jsonResponse({ error: verified.error }, verified.status);

  // body may legitimately be empty `{}` — accept that.
  const parsed = Body.safeParse(verified.body ?? {});
  if (!parsed.success) {
    return jsonResponse(
      { error: "invalid_body", detail: parsed.error.flatten() },
      400,
    );
  }
  const { since, limit = 100 } = parsed.data;

  // Pull broadcast-flagged, approved-or-applied suggestions from any
  // app *other than* the caller. Embed source app slug for display.
  let q = admin
    .from("hub_suggestions")
    .select(
      "id, app_id, source, title, rationale, target_scope, proposed_change, evidence, confidence, updated_at, hub_apps:hub_apps!hub_suggestions_app_id_fkey(id,slug)",
    )
    .eq("broadcast", true)
    .in("status", ["approved", "applied"])
    .order("updated_at", { ascending: true })
    .limit(limit);

  // app_id IS NULL rows are intentional cross-app suggestions — always
  // included. For app-scoped rows, exclude the caller's own.
  q = q.or(`app_id.is.null,app_id.neq.${verified.appId}`);

  if (since) q = q.gt("updated_at", since);

  const { data, error } = await q;
  if (error) {
    return jsonResponse({ error: "query_failed", detail: error.message }, 500);
  }

  const rows = (data ?? []) as unknown as SuggestionRow[];

  // For each suggestion, list app slugs where the tunable is currently
  // applied (best-effort context for the caller's admin UI).
  const tunableKeys = Array.from(
    new Set(
      rows
        .map((r) => {
          const pc = r.proposed_change as Record<string, unknown> | null;
          return pc && typeof pc.tunable_key === "string"
            ? (pc.tunable_key as string)
            : null;
        })
        .filter((k): k is string => !!k),
    ),
  );

  let appliedMap = new Map<string, string[]>();
  if (tunableKeys.length > 0) {
    const { data: tuns } = await admin
      .from("hub_tunables")
      .select("key, hub_apps:hub_apps!hub_tunables_app_id_fkey(slug)")
      .in("key", tunableKeys);

    for (const t of (tuns ?? []) as Array<{ key: string; hub_apps: { slug: string } | null }>) {
      if (!t.hub_apps?.slug) continue;
      const list = appliedMap.get(t.key) ?? [];
      list.push(t.hub_apps.slug);
      appliedMap.set(t.key, list);
    }
  }

  const suggestions = rows.map((r) => {
    const pc = r.proposed_change as Record<string, unknown> | null;
    const key = pc && typeof pc.tunable_key === "string"
      ? (pc.tunable_key as string)
      : null;
    return {
      id: r.id,
      source_app: r.hub_apps ? { id: r.hub_apps.id, slug: r.hub_apps.slug } : null,
      source: r.source,
      title: r.title,
      rationale: r.rationale,
      target_scope: r.target_scope,
      proposed_change: r.proposed_change,
      evidence: r.evidence,
      confidence: r.confidence,
      applied_in_apps: key ? appliedMap.get(key) ?? [] : [],
      updated_at: r.updated_at,
    };
  });

  const nextSince = suggestions.length > 0
    ? suggestions[suggestions.length - 1].updated_at
    : (since ?? new Date(0).toISOString());

  auditEvent({
    appId: verified.appId,
    actorKind: "app",
    eventType: "broadcasts.pulled",
    payload: { since: since ?? null, returned: suggestions.length },
  }).catch(() => {});

  return jsonResponse({
    ok: true,
    server_time: new Date().toISOString(),
    suggestions,
    next_since: nextSince,
  });
});
