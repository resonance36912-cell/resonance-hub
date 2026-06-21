// =====================================================================
// ROP Hub — cron-measure-outcomes
// Target path: supabase/functions/cron-measure-outcomes/index.ts
// =====================================================================
//
// Periodic job (every ~1 h via pg_cron) that measures whether applied
// suggestions actually improved their target metric. For each
// `hub_suggestions` row with status='applied' and applied_at in the
// window [now-7d, now-24h] that has NO `hub_outcomes` row yet:
//
//   - locate the metric to measure (evidence.measure_metric, falling
//     back to a metric named in proposed_change.metric, else skip)
//   - baseline  = avg(value_num) over [applied_at - 24h, applied_at]
//   - observed  = avg(value_num) over [applied_at, applied_at + 24h]
//   - delta_pct = (observed - baseline) / baseline * 100
//   - verdict   = improved | regressed | neutral | inconclusive
//                 (configurable thresholds; defaults: ±5% margin,
//                  min sample size 20)
//
// Auth: ROP_CRON_SECRET header.

import { corsHeaders, jsonResponse } from "../_shared/rop-verify.ts";
import { requireCronSecret, adminClient } from "../_shared/rop-admin-auth.ts";
import { auditEvent } from "../_shared/rop-lookups.ts";

const IMPROVED_MARGIN_PCT = 5;
const MIN_SAMPLE = 20;
const BASELINE_WINDOW_MS = 24 * 60 * 60 * 1000;
const OBSERVED_WINDOW_MS = 24 * 60 * 60 * 1000;

type SuggRow = {
  id: string;
  app_id: string;
  applied_at: string;
  evidence: Record<string, unknown> | null;
  proposed_change: Record<string, unknown> | null;
  target_scope: string;
};

function pickMetric(s: SuggRow): string | null {
  const ev = s.evidence ?? {};
  const pc = s.proposed_change ?? {};
  if (typeof ev.measure_metric === "string") return ev.measure_metric;
  if (typeof pc.metric === "string") return pc.metric;
  return null;
}

// "lower is better" metric heuristic: anything ending in *_ms, *_latency,
// *_errors, *_failures, or *.error_rate inverts the verdict direction.
function lowerIsBetter(metric: string): boolean {
  return /(_ms$|_latency$|_errors$|_failures$|error_rate$|cost$)/i.test(metric);
}

async function avgMetric(
  admin: ReturnType<typeof adminClient>,
  appId: string,
  metric: string,
  fromIso: string,
  toIso: string,
): Promise<{ avg: number | null; n: number }> {
  const { data, error } = await admin
    .from("hub_perf_events")
    .select("value_num")
    .eq("app_id", appId)
    .eq("metric", metric)
    .gte("client_ts", fromIso)
    .lt("client_ts", toIso)
    .not("value_num", "is", null)
    .limit(5000);
  if (error || !data) return { avg: null, n: 0 };
  const nums = data
    .map((r) => r.value_num as number | null)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return { avg: null, n: 0 };
  const sum = nums.reduce((a, b) => a + b, 0);
  return { avg: sum / nums.length, n: nums.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "method_not_allowed" }, 405);
  if (!requireCronSecret(req))  return jsonResponse({ error: "unauthorized" }, 401);

  const admin = adminClient();

  const now = Date.now();
  const upperBound = new Date(now - OBSERVED_WINDOW_MS).toISOString();
  const lowerBound = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Pull applied suggestions in the eligible window that have no outcome yet.
  // (Done with two queries since PostgREST `NOT EXISTS` requires a view.)
  const { data: applied, error: aErr } = await admin
    .from("hub_suggestions")
    .select("id, app_id, applied_at, evidence, proposed_change, target_scope")
    .eq("status", "applied")
    .not("app_id", "is", null)
    .gte("applied_at", lowerBound)
    .lt("applied_at", upperBound)
    .limit(200);
  if (aErr) return jsonResponse({ error: aErr.message }, 500);

  const rows = (applied ?? []) as SuggRow[];
  if (rows.length === 0) {
    return jsonResponse({ ok: true, evaluated: 0, written: 0 });
  }

  const { data: existing } = await admin
    .from("hub_outcomes")
    .select("suggestion_id")
    .in("suggestion_id", rows.map((r) => r.id));
  const done = new Set((existing ?? []).map((r) => r.suggestion_id as string));

  let written = 0;
  let regressed = 0;
  let improved = 0;

  for (const s of rows) {
    if (done.has(s.id)) continue;
    const metric = pickMetric(s);
    if (!metric) continue;

    const appliedAtMs = new Date(s.applied_at).getTime();
    const bFrom = new Date(appliedAtMs - BASELINE_WINDOW_MS).toISOString();
    const bTo   = new Date(appliedAtMs).toISOString();
    const oFrom = bTo;
    const oTo   = new Date(appliedAtMs + OBSERVED_WINDOW_MS).toISOString();

    const [base, obs] = await Promise.all([
      avgMetric(admin, s.app_id, metric, bFrom, bTo),
      avgMetric(admin, s.app_id, metric, oFrom, oTo),
    ]);

    const sampleSize = Math.min(base.n, obs.n);
    let verdict: "improved" | "regressed" | "neutral" | "inconclusive" = "inconclusive";
    let deltaPct: number | null = null;

    if (
      base.avg !== null &&
      obs.avg !== null &&
      base.avg !== 0 &&
      sampleSize >= MIN_SAMPLE
    ) {
      deltaPct = ((obs.avg - base.avg) / Math.abs(base.avg)) * 100;
      const lib = lowerIsBetter(metric);
      const improvedDir = lib ? deltaPct < -IMPROVED_MARGIN_PCT : deltaPct >  IMPROVED_MARGIN_PCT;
      const regressedDir = lib ? deltaPct >  IMPROVED_MARGIN_PCT : deltaPct < -IMPROVED_MARGIN_PCT;
      verdict = improvedDir ? "improved" : regressedDir ? "regressed" : "neutral";
    }

    const { error: outErr } = await admin.from("hub_outcomes").insert({
      suggestion_id: s.id,
      app_id: s.app_id,
      metric,
      baseline_value: base.avg,
      observed_value: obs.avg,
      delta_pct: deltaPct,
      sample_size: sampleSize,
      window_start: bFrom,
      window_end: oTo,
      verdict,
      notes:
        sampleSize < MIN_SAMPLE
          ? `insufficient samples (have ${sampleSize}, need ${MIN_SAMPLE})`
          : null,
    });
    if (!outErr) {
      written += 1;
      if (verdict === "improved")  improved  += 1;
      if (verdict === "regressed") regressed += 1;
    }
  }

  await auditEvent({
    appId: null,
    actorKind: "system",
    eventType: "outcomes.measured",
    payload: { evaluated: rows.length, written, improved, regressed },
  });

  return jsonResponse({
    ok: true,
    evaluated: rows.length,
    written,
    improved,
    regressed,
  });
});
