// Cron: for each outcome row whose baseline is ≥ 24h old and not yet measured,
// compare post-apply perf to the baseline and write a verdict.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

export const Route = createFileRoute("/api/public/rop/cron/measure-outcomes")({
  server: {
    handlers: {
      POST: async () => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: pending, error } = await supabaseAdmin
          .from("hub_outcomes")
          .select("id, hub_suggestion_id, app_id, baseline, baseline_at")
          .is("measured_at", null)
          .lt("baseline_at", cutoff)
          .limit(50);
        if (error) {
          console.error("[rop] outcome read failed", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
        }

        let measured = 0;
        for (const o of pending ?? []) {
          const baseline = (o.baseline ?? {}) as { target_key?: string };
          // perf window = since baseline_at
          const { data: perf } = await supabaseAdmin
            .from("hub_perf_events")
            .select("duration_ms, status")
            .eq("app_id", o.app_id)
            .gt("occurred_at", o.baseline_at)
            .limit(5000);

          const durs: number[] = [];
          let errs = 0;
          let n = 0;
          for (const r of perf ?? []) {
            n += 1;
            if (typeof r.duration_ms === "number") durs.push(r.duration_ms);
            if (r.status && r.status !== "ok") errs += 1;
          }
          const p95After = p95(durs);
          const errorRate = n > 0 ? errs / n : 0;
          const measuredJson = {
            target_key: baseline.target_key ?? null,
            samples: n,
            p95_ms: p95After,
            error_rate: Number(errorRate.toFixed(3)),
            captured_at: new Date().toISOString(),
          };
          // Verdict heuristics — proper baseline would need pre-apply window;
          // for now: success if samples ≥ 20 and error_rate < 0.05, else neutral.
          let verdict: "success" | "regression" | "neutral" = "neutral";
          if (n >= 20) {
            if (errorRate >= 0.1) verdict = "regression";
            else if (errorRate < 0.05) verdict = "success";
          }

          await supabaseAdmin
            .from("hub_outcomes")
            .update({
              measured: measuredJson as any,
              verdict,
              measured_at: new Date().toISOString(),
            })
            .eq("id", o.id);
          measured += 1;
        }

        await supabaseAdmin.from("hub_audit_events").insert({
          kind: "cron.measure_outcomes",
          payload: { measured } as any,
        });

        return new Response(JSON.stringify({ ok: true, measured }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
