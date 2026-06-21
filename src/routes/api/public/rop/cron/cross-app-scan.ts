// Cron: scan recent perf telemetry across apps, ask Lovable AI for cross-app suggestions.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RCGF_PRINCIPLES_FOR_AI, RCGF_VERSION } from "@/lib/rcgf";

type PerfRow = {
  app_id: string;
  event_type: string;
  value_num: number | null;
  value_text: string | null;
  tags: Record<string, unknown> | null;
};

type Bucket = {
  app_id: string;
  event_type: string;
  n: number;
  p95: number;
  errorRate: number;
};

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function summarise(rows: PerfRow[]): Bucket[] {
  const map = new Map<string, { app_id: string; event_type: string; durs: number[]; errs: number; n: number }>();
  for (const r of rows) {
    const key = `${r.app_id}::${r.event_type}`;
    let b = map.get(key);
    if (!b) {
      b = { app_id: r.app_id, event_type: r.event_type, durs: [], errs: 0, n: 0 };
      map.set(key, b);
    }
    b.n += 1;
    if (typeof r.value_num === "number") b.durs.push(r.value_num);
    const status = (r.tags?.status as string | undefined) ?? r.value_text;
    if (status && status !== "ok") b.errs += 1;
  }
  return Array.from(map.values())
    .filter((b) => b.n >= 5)
    .map((b) => ({
      app_id: b.app_id,
      event_type: b.event_type,
      n: b.n,
      p95: p95(b.durs),
      errorRate: b.n > 0 ? b.errs / b.n : 0,
    }))
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 12);
}

async function authorSuggestionsWithAI(
  buckets: Bucket[],
  apps: { id: string; slug: string; name: string }[],
) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || buckets.length === 0) return [];

  const slugMap = new Map(apps.map((a) => [a.id, a.slug] as const));
  const compact = buckets.map((b) => ({
    app: slugMap.get(b.app_id) ?? b.app_id,
    event_type: b.event_type,
    samples: b.n,
    p95_ms: b.p95,
    error_rate: Number(b.errorRate.toFixed(3)),
  }));

  const systemPrompt = `${RCGF_PRINCIPLES_FOR_AI}

You are the Resonance Optimization Protocol cross-app analyst, operating under RCGF v${RCGF_VERSION}.
You receive aggregated 24h perf buckets across multiple Resonance apps.
Return JSON: {"suggestions":[{"app":"<slug-or-null>","title":"...","rationale":"...","target_scope":"...","current_value":...,"suggested_value":...}]}.
Rules:
- Only propose changes when p95_ms > 8000 or error_rate > 0.05.
- If a problem appears in MULTIPLE apps, set "app": null (broadcast candidate).
- target_scope is a dot-path (e.g. "video.max_concurrent_jobs").
- "rationale" MUST cite the bucket evidence (samples, p95_ms, error_rate) it relies on, per Article VII.
- Never invent metrics that are not in the input. If evidence is thin, return {"suggestions":[]}.
- Max 5 suggestions. Return only valid JSON, no prose.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
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
        title: string;
        rationale?: string;
        target_scope?: string;
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
          .select("app_id, event_type, value_num, value_text, tags")
          .gt("client_ts", since)
          .limit(20000);
        if (perfErr) {
          console.error("[rop] perf read failed", perfErr);
          return new Response(JSON.stringify({ ok: false, error: perfErr.message }), { status: 500 });
        }

        const { data: apps } = await supabaseAdmin
          .from("hub_apps")
          .select("id, slug, name")
          .eq("status", "active");

        const buckets = summarise((perf ?? []) as PerfRow[]);
        const slugToId = new Map((apps ?? []).map((a) => [a.slug, a.id] as const));
        const suggestions = await authorSuggestionsWithAI(buckets, apps ?? []);

        const today = new Date().toISOString().slice(0, 10);
        let inserted = 0;
        for (const s of suggestions) {
          const appId = s.app ? slugToId.get(s.app) ?? null : null;
          const localId = `cross_app:${s.target_scope ?? s.title}:${today}`;
          // dedupe via evidence->>local_id
          const { data: existing } = await supabaseAdmin
            .from("hub_suggestions")
            .select("id")
            .eq("evidence->>local_id", localId)
            .maybeSingle();
          if (existing) continue;
          const { error } = await supabaseAdmin.from("hub_suggestions").insert({
            app_id: appId,
            source: "cross_app",
            title: s.title,
            rationale: s.rationale ?? "",
            target_scope: s.target_scope ?? "unspecified",
            proposed_change: {
              current_value: s.current_value ?? null,
              suggested_value: s.suggested_value ?? null,
            } as never,
            evidence: { local_id: localId, buckets } as never,
            broadcast: appId === null,
          });
          if (!error) inserted += 1;
        }

        await supabaseAdmin.from("hub_audit_events").insert({
          actor_kind: "system",
          event_type: "cron.cross_app_scan",
          payload: { bucket_count: buckets.length, suggestions: inserted } as never,
        });

        return new Response(
          JSON.stringify({ ok: true, buckets: buckets.length, suggestions: inserted }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
