import { createFileRoute, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import { listAllSubscriptions, type AdminSubRow } from "@/lib/admin-revenue.functions";
import { getVisitStats } from "@/lib/visits.functions";
import { listPayfastAudit } from "@/lib/payfast-audit.functions";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin — Resonance" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await ronsAuth.getUser();
    if (error || !data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/admin/login" });
  },
  component: AdminHome,
});

const zar = (cents: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(cents / 100);

function AdminHome() {
  const fetchAll = useServerFn(listAllSubscriptions);
  const fetchVisits = useServerFn(getVisitStats);
  const fetchAudit = useServerFn(listPayfastAudit);
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-home"],
    queryFn: () => fetchAll(),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const visitsQ = useQuery({
    queryKey: ["admin-visits"],
    queryFn: () => fetchVisits(),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const auditQ = useQuery({
    queryKey: ["admin-payfast-audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });

  const rows = (data?.rows ?? []) as AdminSubRow[];
  const visits = visitsQ.data;
  const traces = auditQ.data?.traces ?? [];

  const kpis = useMemo(() => {
    const realised = rows.filter((r) => r.status === "active" || r.status === "past_due");
    const revenue = realised.reduce((a, r) => a + r.amount_cents, 0);
    const profit = realised.reduce((a, r) => a + r.profit_cents, 0);
    const byApp = new Map<string, { count: number; revenue: number }>();
    for (const r of realised) {
      const cur = byApp.get(r.app) ?? { count: 0, revenue: 0 };
      cur.count += 1;
      cur.revenue += r.amount_cents;
      byApp.set(r.app, cur);
    }
    const recent = [...rows]
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 8);
    return {
      revenue,
      profit,
      activeCount: realised.length,
      totalCount: rows.length,
      byApp: Array.from(byApp.entries()).sort((a, b) => b[1].revenue - a[1].revenue),
      recent,
    };
  }, [rows]);

  async function signOut() {
    await ronsAuth.signOut();
    navigate({ to: "/admin/login" });
  }

  const sections = [
    { to: "/admin/control-center", label: "RONS Control Center", desc: "AI development council, governance gates, provider costs, and promotion workspace." },
    { to: "/admin/rd", label: "R&D Bridge", desc: "Governed ChatGPT/MCP development access, Nova + DataNest context, and remote-evidence boundary." },
    { to: "/admin/rnd", label: "Admin / R&D", desc: "Sovereign Ealiophin diagnostics, audited jobs, and gated optimization controls." },
    { to: "/admin/revenue", label: "Revenue & Profit", desc: "Per-subscription revenue, costs, and profit." },
    { to: "/admin/billing", label: "Billing Overview", desc: "Cross-app subscriptions, wallets, and ledger activity." },
    { to: "/admin/credits", label: "Credit Adjustments", desc: "Add or subtract subscription credits with a full audit trail." },
    { to: "/admin/payfast-audit", label: "PayFast Audit", desc: "Launch ↔ ITN trace and amount reconciliation." },
    { to: "/admin/webhooks", label: "Raw ITN Log", desc: "Every ITN webhook received from PayFast." },
    { to: "/admin/entitlement-diagnostics", label: "Entitlement Diagnostics", desc: "Last 50 entitlement checks across spoke apps." },
    { to: "/admin/rop", label: "Optimization Protocol", desc: "Register spoke apps, mint signing keys, review suggestions and outcomes." },
    { to: "/admin/emails", label: "Email Queue", desc: "Transactional sends and delivery status." },
    { to: "/admin/email-domain", label: "Email Domain", desc: "Sending domain configuration and DNS." },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-10 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Resonance Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">Sales Overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live view of subscriptions, PayFast payments, and site traffic. Auto-refreshes every 15s.
            </p>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-accent"
          >
            Sign out
          </button>
        </header>

        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(error as Error).message}
          </div>
        )}

        {data && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Kpi label="Active subs" value={String(kpis.activeCount)} />
              <Kpi label="Total subs" value={String(kpis.totalCount)} />
              <Kpi label="Revenue (realised)" value={zar(kpis.revenue)} />
              <Kpi
                label="Profit (realised)"
                value={zar(kpis.profit)}
                accent={kpis.profit >= 0 ? "text-emerald-400" : "text-red-400"}
              />
            </section>

            <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
              <Kpi label="Visits (24h)" value={visits ? String(visits.total24h) : "—"} />
              <Kpi label="Unique sessions (24h)" value={visits ? String(visits.uniqueSessions24h) : "—"} />
              <Kpi label="Visits (7d)" value={visits ? String(visits.total7d) : "—"} />
              <Kpi label="Visits (all time)" value={visits ? String(visits.totalAll) : "—"} />
            </section>

            <section className="mb-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Revenue by app
              </h2>
              {kpis.byApp.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active subscriptions yet.</p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {kpis.byApp.map(([app, v]) => (
                    <div key={app} className="rounded-xl border border-border bg-card p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{app}</p>
                      <p className="mt-1 text-xl font-semibold">{zar(v.revenue)}</p>
                      <p className="text-xs text-muted-foreground">{v.count} active</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mb-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent activity
              </h2>
              {kpis.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No subscription activity yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">When</th>
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">App</th>
                        <th className="px-4 py-3">Tier</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.recent.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-4 py-3 font-mono text-xs">
                            {new Date(r.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {r.user_email ?? <span className="font-mono">{r.user_id.slice(0, 8)}…</span>}
                          </td>
                          <td className="px-4 py-3">{r.app}</td>
                          <td className="px-4 py-3">{r.tier}</td>
                          <td className="px-4 py-3 text-xs">{r.status}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {zar(r.amount_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mb-10 grid lg:grid-cols-2 gap-6">
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent PayFast payments
                </h2>
                {traces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No PayFast activity yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2 text-right">Sent</th>
                          <th className="px-3 py-2 text-right">Accepted</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {traces.slice(0, 8).map((t) => {
                          const when =
                            t.launch?.created_at ?? t.itns[0]?.received_at ?? "";
                          const badge =
                            t.match === "match"
                              ? "text-emerald-400"
                              : t.match === "mismatch"
                              ? "text-red-400"
                              : t.match === "rejected"
                              ? "text-red-400"
                              : "text-muted-foreground";
                          return (
                            <tr key={t.m_payment_id} className="border-t border-border">
                              <td className="px-3 py-2 font-mono text-xs">
                                {when ? new Date(when).toLocaleString() : "—"}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {t.launch?.sku ?? t.itns[0]?.sku ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {t.sent_amount_cents != null ? zar(t.sent_amount_cents) : "—"}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">
                                {t.accepted_amount_cents != null
                                  ? zar(t.accepted_amount_cents)
                                  : "—"}
                              </td>
                              <td className={`px-3 py-2 text-xs ${badge}`}>{t.match}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Top pages (24h)
                </h2>
                {!visits || visits.topPaths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No visits in the last 24 hours.</p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Path</th>
                          <th className="px-3 py-2 text-right">Hits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visits.topPaths.map((p) => (
                          <tr key={p.path} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-xs truncate max-w-[260px]">
                              {p.path}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{p.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h2 className="mt-6 mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent visits
                </h2>
                {!visits || visits.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent visits.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">Path</th>
                          <th className="px-3 py-2">Referrer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visits.recent.map((v) => (
                          <tr key={v.id} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-xs">
                              {new Date(v.created_at).toLocaleTimeString()}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs truncate max-w-[180px]">
                              {v.path}
                            </td>
                            <td className="px-3 py-2 text-xs truncate max-w-[180px] text-muted-foreground">
                              {v.referrer ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Admin tools
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="block rounded-xl border border-border bg-card p-5 hover:bg-accent/40 transition"
              >
                <p className="font-semibold">{s.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent ?? ""}`}>{value}</p>
    </div>
  );
}
