// =====================================================================
// ROP Hub — cron-cross-app-scan
// Target path: supabase/functions/cron-cross-app-scan/index.ts
// =====================================================================
//
// Periodic scanner (every ~30 min via pg_cron) that looks for
// optimization patterns visible across multiple apps and, when the
// signal is strong enough, creates `hub_suggestions` rows with
// source='cross_app' and broadcast=true so other apps can pull them.
//
// Auth: ROP_CRON_SECRET header (no user context).
//
// Heuristic v1 — "applied-elsewhere broadcast":
//   For each tunable key K already applied by >=2 distinct apps:
//     - identify the modal value V across those apps
//     - find apps that DO NOT have a tunable for K, OR have a
//       different value
//     - emit one cross-app suggestion per missing app, idempotent on
//       (target_scope=K, evidence.applied_in -> sorted list of slugs)
//
// This is intentionally conservative; smarter pattern mining
// (regression on perf events) is a follow-up.

import { corsHeaders, jsonResponse } from "../_shared/rop-verify.ts";
import { requireCronSecret, adminClient } from "../_shared/rop-admin-auth.ts";
import { auditEvent } from "../_shared/rop-lookups.ts";

type TunableRow = {
  app_id: string;
  key: string;
  value: unknown;
};

type AppRow = { id: string; slug: string; status: string };

function jsonValueKey(v: unknown): string {
  // Stable string key for value comparison/grouping.
  return JSON.stringify(v ?? null);
}

function modal<T>(values: T[]): { value: T; count: number } | null {
  const counts = new Map<string, { value: T; count: number }>();
  for (const v of values) {
    const k = JSON.stringify(v);
    const entry = counts.get(k);
    if (entry) entry.count += 1;
    else counts.set(k, { value: v, count: 1 });
  }
  let best: { value: T; count: number } | null = null;
  for (const c of counts.values()) {
    if (!best || c.count > best.count) best = c;
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!requireCronSecret(req))  return jsonResponse({ error: "unauthorized" }, 401);

  const admin = adminClient();

  const [{ data: tuns, error: tunErr }, { data: apps, error: appErr }] = await Promise.all([
    admin.from("hub_tunables").select("app_id, key, value"),
    admin.from("hub_apps").select("id, slug, status").eq("status", "active"),
  ]);
  if (tunErr) return jsonResponse({ error: tunErr.message }, 500);
  if (appErr) return jsonResponse({ error: appErr.message }, 500);

  const tunables = (tuns ?? []) as TunableRow[];
  const activeApps = (apps ?? []) as AppRow[];
  const appById = new Map(activeApps.map((a) => [a.id, a]));

  // Group tunables by key.
  const byKey = new Map<string, TunableRow[]>();
  for (const t of tunables) {
    const arr = byKey.get(t.key) ?? [];
    arr.push(t);
    byKey.set(t.key, arr);
  }

  const proposals: Array<{
    target_scope: string;
    proposed_change: Record<string, unknown>;
    evidence: Record<string, unknown>;
    rationale: string;
    confidence: number;
    title: string;
    external_id: string;
  }> = [];

  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    const appliedSlugs = rows
      .map((r) => appById.get(r.app_id)?.slug)
      .filter((s): s is string => !!s)
      .sort();
    if (appliedSlugs.length < 2) continue;

    const m = modal(rows.map((r) => r.value));
    if (!m || m.count < 2) continue;
    const modalValue = m.value;
    const modalKey = jsonValueKey(modalValue);

    // Apps missing this tunable OR holding a different value.
    const haveByApp = new Map(rows.map((r) => [r.app_id, r.value]));
    const targets = activeApps.filter((a) => {
      if (!haveByApp.has(a.id)) return true;
      return jsonValueKey(haveByApp.get(a.id)) !== modalKey;
    });
    if (targets.length === 0) continue;

    const confidence = Math.min(0.95, m.count / activeApps.length);

    for (const target of targets) {
      const externalId = `cross_app:${key}:${modalKey}:${target.id}`;
      proposals.push({
        target_scope: key,
        proposed_change: {
          tunable_key: key,
          from: haveByApp.get(target.id) ?? null,
          to: modalValue,
        },
        evidence: {
          external_id: externalId,
          applied_in: appliedSlugs,
          modal_count: m.count,
          total_active_apps: activeApps.length,
        },
        rationale:
          `${m.count} apps (${appliedSlugs.join(", ")}) currently apply ` +
          `${key} = ${modalKey}. ${target.slug} is missing or diverges.`,
        confidence,
        title: `Adopt ${key} = ${modalKey} (used by ${m.count} app${m.count > 1 ? "s" : ""})`,
        external_id: externalId,
      });
    }
  }

  // Idempotent insert: skip rows whose external_id already exists in
  // hub_suggestions for app_id IS NULL (cross-app suggestions are
  // workspace-scoped, not app-scoped, so we store them with app_id NULL
  // and target the recipient via evidence.target_app_slug).
  let inserted = 0;
  for (const p of proposals) {
    const { data: existing } = await admin
      .from("hub_suggestions")
      .select("id")
      .is("app_id", null)
      .filter("evidence->>external_id", "eq", p.external_id)
      .maybeSingle();
    if (existing) continue;

    const { error: insErr } = await admin.from("hub_suggestions").insert({
      app_id: null,
      source: "cross_app",
      status: "approved",        // auto-approved; admin can still reject
      broadcast: true,
      title: p.title,
      rationale: p.rationale,
      target_scope: p.target_scope,
      proposed_change: p.proposed_change,
      evidence: p.evidence,
      confidence: p.confidence,
    });
    if (!insErr) inserted += 1;
  }

  await auditEvent({
    appId: null,
    actorKind: "system",
    eventType: "cross_app_scan.completed",
    payload: {
      keys_scanned: byKey.size,
      proposals: proposals.length,
      inserted,
    },
  });

  return jsonResponse({
    ok: true,
    keys_scanned: byKey.size,
    proposals: proposals.length,
    inserted,
  });
});
