// Cron: measure outcomes whose window has closed.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertCronAuthorized } from "@/lib/rop/cron-auth";

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

export const Route = createFileRoute("/api/public/rop/cron/measure-outcomes")({
  server: {
    handlers: {
      POST: async () => {
        const nowIso = new Date().toISOString();
        const { data: pending, error } = await supabaseAdmin
          .from("hub_outcomes")
          .select("id, suggestion_id, app_id, metric, window_start, window_end")
          .eq("verdict", "inconclusive")
          .lt("window_end", nowIso)
          .limit(50);
        if (error) {
          console.error("[rop] outcome read failed", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
        }

        let measured = 0;
        for (const o of pending ?? []) {
          const { data: perf } = await supabaseAdmin
            .from("hub_perf_events")
            .select("value_num, value_text, tags")
            .eq("app_id", o.app_id)
            .gt("client_ts", o.window_start)
            .lt("client_ts", o.window_end)
            .limit(5000);

          const durs: number[] = [];
          let errs = 0;
          let n = 0;
          for (const r of perf ?? []) {
            n += 1;
            if (typeof r.value_num === "number") durs.push(r.value_num);
            const tags = (r.tags ?? {}) as Record<string, unknown>;
            const status = (tags.status as string | undefined) ?? r.value_text;
            if (status && status !== "ok") errs += 1;
          }
          const observed = p95(durs);
          const errorRate = n > 0 ? errs / n : 0;

          let verdict: "improved" | "neutral" | "regressed" | "inconclusive" = "inconclusive";
          if (n >= 20) {
            if (errorRate >= 0.1) verdict = "regressed";
            else if (errorRate < 0.05) verdict = "improved";
            else verdict = "neutral";
          }

          await supabaseAdmin
            .from("hub_outcomes")
            .update({
              observed_value: observed,
              sample_size: n,
              verdict,
              notes: `error_rate=${errorRate.toFixed(3)}`,
            })
            .eq("id", o.id);
          measured += 1;
        }

        await supabaseAdmin.from("hub_audit_events").insert({
          actor_kind: "system",
          event_type: "cron.measure_outcomes",
          payload: { measured } as never,
        });

        return new Response(JSON.stringify({ ok: true, measured }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
