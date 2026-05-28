import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listAllSubscriptions, upsertSkuCost, type AdminSubRow } from "@/lib/admin-revenue.functions";

export const Route = createFileRoute("/admin/revenue")({
  head: () => ({
    meta: [
      { title: "Revenue & Profit — Resonance Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw redirect({ to: "/" });
  },
  component: RevenuePage,
});

const money = (cents: number, ccy = "ZAR") =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: ccy }).format(cents / 100);

const statusColor = (s: string) => {
  if (s === "active") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  if (s === "past_due") return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  if (s === "cancelled") return "bg-red-500/20 text-red-300 border-red-500/40";
  return "bg-muted text-muted-foreground border-border";
};

function RevenuePage() {
  const fetchAll = useServerFn(listAllSubscriptions);
  const saveCost = useServerFn(upsertSkuCost);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-revenue"],
    queryFn: () => fetchAll(),
  });

  const [appFilter, setAppFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo<AdminSubRow[]>(() => {
    const rows = (data?.rows ?? []) as AdminSubRow[];
    return rows.filter(
      (r) =>
        (appFilter === "all" || r.app === appFilter) &&
        (statusFilter === "all" || r.status === statusFilter),
    );
  }, [data, appFilter, statusFilter]);

  const filteredTotals = useMemo(() => {
    const realised = filtered.filter((r) => r.status === "active" || r.status === "past_due");
    return {
      revenueCents: realised.reduce((a, r) => a + r.amount_cents, 0),
      costCents: realised.reduce((a, r) => a + r.cost_cents, 0),
      profitCents: realised.reduce((a, r) => a + r.profit_cents, 0),
      activeCount: realised.length,
    };
  }, [filtered]);

  const apps = Array.from(new Set((data?.rows ?? []).map((r) => r.app)));

  const mutation = useMutation({
    mutationFn: (vars: { sku: string; cost_cents: number }) =>
      saveCost({ data: { sku: vars.sku, cost_cents: vars.cost_cents } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-revenue"] }),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Resonance Admin</p>
            <h1 className="mt-2 text-3xl font-semibold">Revenue, Costs & Profit</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              All subscriptions across every Resonance app. Edit per-SKU costs to compute profit.
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

        {data && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              <Kpi label="Active subs" value={String(filteredTotals.activeCount)} />
              <Kpi label="Revenue" value={money(filteredTotals.revenueCents)} />
              <Kpi label="Cost" value={money(filteredTotals.costCents)} />
              <Kpi
                label="Profit"
                value={money(filteredTotals.profitCents)}
                accent={filteredTotals.profitCents >= 0 ? "text-emerald-400" : "text-red-400"}
              />
            </div>

            {/* Filters */}
            <div className="mb-6 flex flex-wrap gap-2">
              <select
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="all">All apps</option>
                {apps.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="pending">Pending</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Cost editor */}
            <section className="mb-10 rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Per-SKU costs
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">SKU</th>
                      <th className="py-2 pr-4">Current cost</th>
                      <th className="py-2 pr-4">Update (ZAR)</th>
                      <th className="py-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.distinctSkus.map((sku) => (
                      <CostRow
                        key={sku}
                        sku={sku}
                        currentCents={data.costs.find((c) => c.sku === sku)?.cost_cents ?? 0}
                        onSave={(cents) => mutation.mutate({ sku, cost_cents: cents })}
                        saving={mutation.isPending}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Subscriptions table */}
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                No subscriptions match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">App</th>
                      <th className="px-4 py-3">Tier</th>
                      <th className="px-4 py-3">Cycle</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Price</th>
                      <th className="px-4 py-3 text-right">Cost</th>
                      <th className="px-4 py-3 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-t border-border hover:bg-accent/30">
                        <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.user_email ?? <span className="font-mono">{r.user_id.slice(0, 8)}…</span>}
                        </td>
                        <td className="px-4 py-3">{r.app}</td>
                        <td className="px-4 py-3">{r.tier}</td>
                        <td className="px-4 py-3">{r.billing_cycle}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded border px-2 py-0.5 text-xs ${statusColor(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{money(r.amount_cents, r.currency)}</td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                          {money(r.cost_cents, r.currency)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono ${
                            r.profit_cents >= 0 ? "text-emerald-300" : "text-red-300"
                          }`}
                        >
                          {money(r.profit_cents, r.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
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

function CostRow({
  sku,
  currentCents,
  onSave,
  saving,
}: {
  sku: string;
  currentCents: number;
  onSave: (cents: number) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState<string>((currentCents / 100).toFixed(2));
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4 font-mono text-xs">{sku}</td>
      <td className="py-2 pr-4 font-mono">{money(currentCents)}</td>
      <td className="py-2 pr-4">
        <input
          type="number"
          step="0.01"
          min="0"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-32 rounded border border-border bg-background px-2 py-1 text-sm font-mono"
        />
      </td>
      <td className="py-2 pr-4">
        <button
          disabled={saving}
          onClick={() => onSave(Math.round(parseFloat(val || "0") * 100))}
          className="rounded border border-border bg-background px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          Save
        </button>
      </td>
    </tr>
  );
}
