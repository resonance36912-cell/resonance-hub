import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listItnLogs } from "@/lib/itn-logs.functions";
import { ROUTES } from "@/lib/routes";

export const Route = createFileRoute("/admin/webhooks")({
  head: () => ({
    meta: [
      { title: "PayFast ITN Logs — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: ROUTES.adminLogin });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw redirect({ to: ROUTES.adminLogin });
  },
  component: WebhooksPage,
});

type Log = {
  id: string;
  received_at: string;
  signature_valid: boolean;
  server_validated: boolean;
  outcome: string;
  http_status: number;
  sku: string | null;
  user_id: string | null;
  amount_cents: number | null;
  payment_status: string | null;
  pf_payment_id: string | null;
  source_ip: string | null;
  error_message: string | null;
  raw_payload: Record<string, string>;
};

function outcomeColor(o: string, status: number) {
  if (status === 200) return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  if (status >= 500) return "bg-red-500/20 text-red-300 border-red-500/40";
  return "bg-amber-500/20 text-amber-300 border-amber-500/40";
}

function WebhooksPage() {
  const fetchLogs = useServerFn(listItnLogs);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["itn-logs"],
    queryFn: () => fetchLogs(),
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Resonance Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">PayFast Webhook Audit</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Last 200 Instant Transaction Notifications received at <code>/api/public/payfast/itn</code>.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent transition disabled:opacity-50"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && data.logs.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            No webhook events recorded yet.
          </div>
        )}

        {data && data.logs.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Sig</th>
                  <th className="px-4 py-3">Validated</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(data.logs as Log[]).map((log) => (
                  <>
                    <tr key={log.id} className="border-t border-border hover:bg-accent/30">
                      <td className="px-4 py-3 font-mono text-xs">
                        {new Date(log.received_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded border px-2 py-0.5 text-xs ${outcomeColor(log.outcome, log.http_status)}`}>
                          {log.outcome} · {log.http_status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{log.signature_valid ? "✓" : "✗"}</td>
                      <td className="px-4 py-3">{log.server_validated ? "✓" : "✗"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{log.sku ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {log.amount_cents != null ? `R${(log.amount_cents / 100).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {log.user_id ? log.user_id.slice(0, 8) + "…" : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                        >
                          {expanded === log.id ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {expanded === log.id && (
                      <tr className="bg-muted/20 border-t border-border">
                        <td colSpan={8} className="px-4 py-3">
                          {log.error_message && (
                            <p className="mb-2 text-xs text-red-300">
                              <strong>Error:</strong> {log.error_message}
                            </p>
                          )}
                          <p className="mb-1 text-xs text-muted-foreground">Source IP: {log.source_ip ?? "—"} · pf_payment_id: {log.pf_payment_id ?? "—"}</p>
                          <pre className="overflow-x-auto rounded bg-background/60 p-3 text-xs">
                            {JSON.stringify(log.raw_payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
