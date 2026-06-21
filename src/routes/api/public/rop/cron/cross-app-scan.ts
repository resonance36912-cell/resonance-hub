// Cron: scan recent perf telemetry across apps, ask Lovable AI to author
// cross-app suggestions, and persist them as source='cross_app'.
// External callers: pg_cron / scheduler hitting /api/public/rop/cron/cross-app-scan
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type PerfRow = {
  app_id: string;
  step: string;
  duration_ms: number | null;
  status: string | null;
  error_code: string | null;
};

type Bucket = {
  app_id: string;
  step: string;
  n: number;
  p95: number;
  errorRate: number;
};

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

function summarise(rows: PerfRow[]): Bucket[] {
  const map = new Map<string, { app_id: string; step: string; durs: number[]; errs: number; n: number }>();
  for (const r of rows) {
    const key = `${r.app_id}::${r.step}`;
    let b = map.get(key);
    if (!b) {
      b = { app_id: r.app_id, step: r.step, durs: [], errs: 0, n: 0 };
      map.set(key, b);
    }
    b.n += 1;
    if (typeof r.duration_ms === "number") b.durs.push(r.duration_ms);
    if (r.status && r.status !== "ok") b.errs += 1;
  }
  return Array.from(map.values())
    .filter((b) => b.n >= 5)
    .map((b) => ({
      app_id: b.app_id,
      step: b.step,
      n: b.n,
      p95: p95(b.durs),
      errorRate: b.n > 0 ? b.errs / b.n : 0,
    }))
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 12);
}

async function authorSuggestionsWithAI(buckets: Bucket[], apps: { id: string; slug: string; name: string }[]) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || buckets.length === 0) return [];

  const slugMap = new Map(apps.map((a) => [a.id, a.slug] as const));
  const compact = buckets.map((b) => ({
    app: slugMap.get(b.app_id) ?? b.app_id,
    step: b.step,
    samples: b.n,
    p95_ms: b.p95,
    error_rate: Number(b.errorRate.toFixed(3)),
  }));

  const systemPrompt = `You are the Resonance Optimization Protocol cross-app analyst.
You receive aggregated 24h perf buckets (step, p95_ms, error_rate) across multiple Resonance apps.
Return JSON: {"suggestions":[{"app":"<slug-or-null>","category":"latency|errors|concurrency|cost","title":"...","rationale":"...","target_key":"...","current_value":...,"suggested_value":...}]}.
Rules:
- Only propose changes when p95 > 8000 ms or error_rate > 0.05.
- If a slow step appears in MULTIPLE apps, set "app": null (broadcast candidate).
- Use short imperative titles. Keep rationale under 300 chars.
- target_key is a dot-path (e.g. "video.max_concurrent_jobs"). Omit if unsure.
- Max 5 suggestions. Return only valid JSON, no prose.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "raw",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ buckets: compact }) },
      ],
    }),
  });

  if (!res.ok) {
    console.error("[rop] AI gateway error", res.status, await res.text());
    return [];
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(text) as {
      suggestions?: Array<{
        app: string | null;
        category?: string;
        title: string;
        rationale?: string;
        target_key?: string;
        current_value?: unknown;
        suggested_value?: unknown;
      }>;
    };
    return (parsed.suggestions ?? []).slice(0, 5);
  } catch (e) {
    console.error("[rop] AI JSON parse failed", e, text);
    return [];
  }
}

export const Route = createFileRoute("/api/public/rop/cron/cross-app-scan")({
  server: {
    handlers: {
      POST: async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: perf, error: perfErr } = await supabaseAdmin
          .from("hub_perf_events")
          .select("app_id, step, duration_ms, status, error_code")
          .gt("occurred_at", since)
          .limit(20000);
        if (perfErr) {
          console.error("[rop] perf read failed", perfErr);
          return new Response(JSON.stringify({ ok: false, error: perfErr.message }), { status: 500 });
        }

        const { data: apps } = await supabaseAdmin
          .from("hub_apps")
          .select("id, slug, name")
          .eq("status", "active");

        const buckets = summarise(perf ?? []);
        const slugToId = new Map((apps ?? []).map((a) => [a.slug, a.id] as const));
        const suggestions = await authorSuggestionsWithAI(buckets, apps ?? []);

        let inserted = 0;
        for (const s of suggestions) {
          const appId = s.app ? slugToId.get(s.app) ?? null : null;
          const localId = `cross_app:${s.target_key ?? s.title}:${new Date().toISOString().slice(0, 10)}`;
          const { error } = await supabaseAdmin
            .from("hub_suggestions")
            .upsert(
              {
                app_id: appId,
                local_id: localId,
                source: "cross_app",
                category: s.category ?? null,
                title: s.title,
                rationale: s.rationale ?? null,
                evidence: { buckets } as any,
                target_key: s.target_key ?? null,
                current_value: (s.current_value ?? null) as any,
                suggested_value: (s.suggested_value ?? null) as any,
              },
              { onConflict: "app_id,local_id" },
            );
          if (!error) inserted += 1;
        }

        await supabaseAdmin.from("hub_audit_events").insert({
          kind: "cron.cross_app_scan",
          payload: { bucket_count: buckets.length, suggestions: inserted } as any,
        });

        return new Response(
          JSON.stringify({ ok: true, buckets: buckets.length, suggestions: inserted }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
