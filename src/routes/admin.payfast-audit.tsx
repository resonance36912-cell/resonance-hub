import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import { listPayfastAudit, type AuditTrace } from "@/lib/payfast-audit.functions";

export const Route = createFileRoute("/admin/payfast-audit")({
  head: () => ({
    meta: [
      { title: "PayFast Audit — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw redirect({ to: "/admin/login" });
  },
  component: AuditPage,
});

function zar(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `R${(cents / 100).toFixed(2)}`;
}

function matchBadge(m: AuditTrace["match"]) {
  switch (m) {
    case "match":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "mismatch":
      return "bg-red-500/20 text-red-300 border-red-500/40";
    case "rejected":
      return "bg-red-500/20 text-red-300 border-red-500/40";
    case "pending":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "no_launch":
      return "bg-slate-500/20 text-slate-300 border-slate-500/40";
  }
}

function AuditPage() {
  const fetchAudit = useServerFn(listPayfastAudit);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["payfast-audit"],
    queryFn: () => fetchAudit(),
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | AuditTrace["match"]>("all");

  const traces = (data?.traces ?? []).filter((t) =>
    filter === "all" ? true : t.match === filter,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Resonance Admin
            </p>
            <h1 className="mt-2 text-3xl font-semibold">PayFast Audit Trail</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Launches matched to ITN returns by{" "}
              <code>m_payment_id</code>. Confirms the amount sent equals the
              amount accepted.
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              <Link to="/admin/webhooks" className="hover:underline text-primary">
                ← Raw ITN log
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="match">Matched</option>
              <option value="mismatch">Mismatch</option>
              <option value="rejected">Rejected</option>
              <option value="pending">Pending</option>
              <option value="no_launch">Orphan ITN</option>
            </select>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent transition disabled:opacity-50"
            >
              {isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && traces.length === 0 && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            No checkout activity matches this filter.
          </div>
        )}

        {traces.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Accepted</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">m_payment_id</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => {
                  const time =
                    t.launch?.created_at ?? t.itns[0]?.received_at ?? "";
                  const sku = t.launch?.sku ?? t.itns[0]?.sku ?? "—";
                  const uid = t.launch?.user_id ?? t.itns[0]?.user_id ?? null;
                  const isOpen = expanded === t.m_payment_id;
                  return (
                    <>
                      <tr
                        key={t.m_payment_id}
                        className="border-t border-border hover:bg-accent/30"
                      >
                        <td className="px-4 py-3 font-mono text-xs">
                          {time ? new Date(time).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded border px-2 py-0.5 text-xs ${matchBadge(t.match)}`}
                          >
                            {t.match}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{sku}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {zar(t.sent_amount_cents)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {zar(t.accepted_amount_cents)}
                          {t.sent_amount_cents != null &&
                            t.accepted_amount_cents != null &&
                            t.sent_amount_cents !== t.accepted_amount_cents && (
                              <span className="ml-2 text-red-400">⚠</span>
                            )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {uid ? uid.slice(0, 8) + "…" : "—"}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {t.m_payment_id.length > 32
                            ? t.m_payment_id.slice(0, 32) + "…"
                            : t.m_payment_id}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="text-xs text-primary hover:underline"
                            onClick={() =>
                              setExpanded(isOpen ? null : t.m_payment_id)
                            }
                          >
                            {isOpen ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/20 border-t border-border">
                          <td colSpan={8} className="px-4 py-4 space-y-4">
                            <section>
                              <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                                Launch
                              </h3>
                              {t.launch ? (
                                <pre className="overflow-x-auto rounded bg-background/60 p-3 text-xs">
                                  {JSON.stringify(t.launch, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  No launch log recorded (ITN received without a
                                  matching launch).
                                </p>
                              )}
                            </section>
                            <section>
                              <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                                ITN attempts ({t.itns.length})
                              </h3>
                              {t.itns.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  No ITN received yet — checkout pending or
                                  abandoned.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {t.itns.map((it) => (
                                    <div
                                      key={it.id}
                                      className="rounded border border-border bg-background/40 p-3 text-xs"
                                    >
                                      <div className="mb-1 flex items-center gap-2">
                                        <span className="font-mono">
                                          {new Date(
                                            it.received_at,
                                          ).toLocaleString()}
                                        </span>
                                        <span className="rounded bg-muted px-1.5 py-0.5">
                                          {it.outcome} · {it.http_status}
                                        </span>
                                        <span>
                                          sig {it.signature_valid ? "✓" : "✗"} /
                                          validated{" "}
                                          {it.server_validated ? "✓" : "✗"}
                                        </span>
                                      </div>
                                      <div className="font-mono">
                                        amount {zar(it.amount_cents)} · status{" "}
                                        {it.payment_status ?? "—"} · pf_id{" "}
                                        {it.pf_payment_id ?? "—"}
                                      </div>
                                      {it.error_message && (
                                        <div className="mt-1 text-red-300">
                                          {it.error_message}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </section>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
