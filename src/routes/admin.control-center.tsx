import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ronsAuth } from "@/lib/auth-provider";
import { getRonsControlState } from "@/lib/rons-control.functions";
import {
  compareAiCouncil,
  getAiBrokerState,
  setAiProviderState,
  promoteCouncilRecommendation,
} from "@/lib/ai-broker.functions";
import { getCostingStudy } from "@/lib/costing-study.functions";
import { useState } from "react";

export const Route = createFileRoute("/admin/control-center")({
  head: () => ({
    meta: [
      { title: "RONS Control Center — Resonance Admin" },
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
  component: ControlCenter,
});

type LocalHealth = {
  ok?: boolean;
  model?: string;
};

type CouncilResult = {
  provider?: unknown;
  text?: unknown;
  model?: unknown;
  receipt_id?: unknown;
  ok?: boolean;
  cost_usd?: number;
  latency_ms?: number;
  error?: unknown;
};

const usd = (v: number | null) => (v == null ? "Configure" : "$" + v.toFixed(v < 1 ? 2 : 0) + " / 1M");

function ControlCenter() {
  const fetchState = useServerFn(getRonsControlState);
  const q = useQuery({
    queryKey: ["rons-control-state"],
    queryFn: () => fetchState(),
    refetchInterval: 5000,
  });
  const d = q.data;
  const compare = useServerFn(compareAiCouncil);
  const getBroker = useServerFn(getAiBrokerState);
  const getCosting = useServerFn(getCostingStudy);
  const setProvider = useServerFn(setAiProviderState);
  const promoteRecommendation = useServerFn(promoteCouncilRecommendation);
  const broker = useQuery({
    queryKey: ["rons-ai-broker-state"],
    queryFn: () => getBroker(),
    refetchInterval: 5000,
  });
  const costing = useQuery({
    queryKey: ["rons-costing-study"],
    queryFn: () => getCosting(),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const providerState = useMutation({
    mutationFn: (v: { provider: string; enabled: boolean; approved: boolean }) =>
      setProvider({ data: v }),
    onSuccess: () => broker.refetch(),
  });
  const [prompt, setPrompt] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>(["rons-local"]);
  const [approveExternalRun, setApproveExternalRun] = useState(false);
  const council = useMutation({
    mutationFn: () =>
      compare({
        data: {
          prompt,
          system:
            "Apply RCGF v1.0. Analyze this RONS optimization request. Return recommendations only; no production authority.",
          providers: selectedProviders,
          human_approved_external: approveExternalRun,
        },
      }),
    onSuccess: () => setApproveExternalRun(false),
  });
  const promote = useMutation({
    mutationFn: (r: CouncilResult) =>
      promoteRecommendation({
        data: {
          title: `AI Council: ${String(r.provider)}`,
          rationale: String(r.text ?? ""),
          target_scope: "rons",
          provider: String(r.provider),
          model: String(r.model ?? ""),
          receipt_id: String(r.receipt_id ?? ""),
          prompt,
        },
      }),
  });
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-12 space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Resonance Admin · RONS
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              AI Development & Governance Control Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Governed optimization across local RONS and approved external AI providers, with cost
              visibility, promotion assets, and human approval gates.
            </p>
          </div>
          <Link
            to="/admin"
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            ← Admin
          </Link>
        </header>

        {q.isLoading && <p className="text-muted-foreground">Loading control plane…</p>}
        {q.error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300">
            {(q.error as Error).message}
          </div>
        )}
        {d && (
          <>
            <section className="grid md:grid-cols-4 gap-3">
              <Card
                label="Governance"
                value={d.governance.framework}
                sub="Human sovereignty: enforced"
              />
              <Card
                label="Local AI"
                value={(d.localHealth as LocalHealth).ok ? "ONLINE" : "OFFLINE"}
                sub={String((d.localHealth as LocalHealth).model ?? "RONS local model")}
              />
              <Card label="External AI" value="APPROVAL GATED" sub="Disabled by default" />
              <Card
                label="Cost feed"
                value="5s refresh"
                sub={`Updated ${new Date(d.generatedAt).toLocaleTimeString()}`}
              />
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Resonance Governance Protocol</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {d.governance.workflow.map((s, i) => (
                  <span
                    key={s}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs"
                  >
                    {i + 1}. {s}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                External providers, governance changes, production deployment, destructive database
                changes, secret rotation and network enablement remain human-approved actions.
                Receipts are append-only.
              </p>
            </section>
            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">AI provider cost board</h2>
                  <p className="text-sm text-muted-foreground">
                    Rates are separated from historical usage receipts; local RONS remains
                    zero-credit.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">USD token rates</span>
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.providers.map((p) => (
                  <div key={p.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{p.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wide ${p.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
                      >
                        {p.enabled ? "enabled" : "approval required"}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-background p-3">
                        <p className="text-xs text-muted-foreground">Input</p>
                        <p className="mt-1 font-mono">{usd(p.inputUsdM)}</p>
                      </div>
                      <div className="rounded-lg bg-background p-3">
                        <p className="text-xs text-muted-foreground">Output</p>
                        <p className="mt-1 font-mono">{usd(p.outputUsdM)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">Provider activation</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  External providers require a local secret file plus explicit enable + approval.
                  Local RONS remains immutable and always available.
                </p>
                <div className="mt-4 space-y-3">
                  {(broker.data?.providers ?? []).map((p) => (
                    <div key={p.id} className="rounded-lg border border-border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.model} · {p.secret_ready ? "secret ready" : "secret missing"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.kind === "local" ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
                              sovereign
                            </span>
                          ) : (
                            <button
                              disabled={!p.secret_ready || providerState.isPending}
                              onClick={() =>
                                providerState.mutate({
                                  provider: p.id,
                                  enabled: !(p.enabled && p.approved),
                                  approved: !(p.enabled && p.approved),
                                })
                              }
                              className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40"
                            >
                              {p.enabled && p.approved ? "Disable" : "Approve + enable"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {providerState.error && (
                  <p className="mt-3 text-sm text-red-400">
                    {(providerState.error as Error).message}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">AI spend telemetry</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Append-only receipt totals. Local RONS remains $0 provider API cost.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    ["today", "Today"],
                    ["7d", "7 days"],
                    ["30d", "30 days"],
                    ["all", "All time"],
                  ].map(([k, label]) => (
                    <div key={k} className="rounded-lg bg-background p-4">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-xl font-semibold">
                        ${Number(broker.data?.summary?.[k]?.cost_usd ?? 0).toFixed(6)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {Number(broker.data?.summary?.[k]?.calls ?? 0)} calls
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Free-promotion costing study</h2>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    Observed usage and provider costs are evidence only. Customer pricing and
                    checkout remain disabled until a governed human pricing decision is made.
                  </p>
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  {costing.data?.promotion.active ? "FREE ACCESS ACTIVE" : "PROMOTION INACTIVE"}
                </span>
              </div>

              {costing.isLoading && (
                <p className="mt-4 text-sm text-muted-foreground">Loading costing evidence…</p>
              )}
              {costing.error && (
                <p className="mt-4 text-sm text-red-400">{(costing.error as Error).message}</p>
              )}

              {costing.data && (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                    <Card
                      label="Checkout"
                      value={costing.data.promotion.checkoutLocked ? "LOCKED" : "OPEN"}
                      sub="Commercial guard"
                    />
                    <Card
                      label="Broker calls"
                      value={String(costing.data.observedAllTime.calls)}
                      sub="Legacy AI receipts · all time"
                    />
                    <Card
                      label="Broker API spend"
                      value={`${Number(costing.data.observedAllTime.cost_usd ?? 0).toFixed(6)}`}
                      sub="Legacy AI receipts · all time"
                    />
                    <Card
                      label="Sovereign events"
                      value={String(costing.data.sovereignLedgerAll.events)}
                      sub="RONS v0.12 ledger · all time"
                    />
                    <Card
                      label="Sovereign API spend"
                      value={`${Number(costing.data.sovereignLedgerAll.provider_api_cost_usd ?? 0).toFixed(6)}`}
                      sub="Provider API charge only"
                    />
                    <Card
                      label="Workload samples"
                      value={String(costing.data.promotionWorkload.total_samples)}
                      sub={`Authenticated · ${costing.data.promotionWorkload.unknown_samples} unattributed`}
                    />
                    <Card
                      label="Manual cost rows"
                      value={String(costing.data.manualCostAssumptions.length)}
                      sub="SKU assumptions retained"
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background p-4">
                      <p className="text-sm font-semibold">Manual SKU-assumption coverage</p>
                      <div className="mt-3 space-y-2">
                        {costing.data.appCoverage.map((app) => (
                          <div
                            key={app.key}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span>{app.label}</span>
                            <span className="text-right text-xs text-muted-foreground">
                              {app.configuredSkuCount} cost row(s) · {app.promotionSamples} workload
                              sample(s) · {app.promotionFailures} failure(s) · avg{" "}
                              {(app.promotionAvgDurationMs / 1000).toFixed(1)}s · p95{" "}
                              {(app.promotionP95DurationMs / 1000).toFixed(1)}s
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-4">
                      <p className="text-sm font-semibold">Evidence health</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          AI spend:{" "}
                          {costing.data.sourceHealth.aiBrokerSpend ? "online" : "unavailable"}
                        </div>
                        <div>
                          Provider registry:{" "}
                          {costing.data.sourceHealth.aiBrokerProviders ? "online" : "unavailable"}
                        </div>
                        <div>
                          SKU costs: {costing.data.sourceHealth.skuCosts ? "online" : "unavailable"}
                        </div>
                        <div>
                          Sovereign ledger:{" "}
                          {costing.data.sourceHealth.sovereignCostLedger ? "online" : "unavailable"}
                        </div>
                        <div>
                          Promotion workload:{" "}
                          {costing.data.sourceHealth.promotionWorkload ? "online" : "unavailable"}
                        </div>
                        <div>
                          Unverified active providers: {costing.data.unverifiedActiveProviderCount}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Sovereign v0.12 cost ledger</p>
                      <span className="text-xs text-muted-foreground">
                        {costing.data.sovereignLedgerAll.costed_events}/
                        {costing.data.sovereignLedgerAll.events} events with provider API cost
                      </span>
                    </div>
                    {costing.data.sovereignLedgerAll.rows.length === 0 ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Ledger online; no production usage receipts recorded yet.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {costing.data.sovereignLedgerAll.rows.map((row) => (
                          <div
                            key={`${row.app}:${row.provider}:${row.operation}`}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span>
                              {row.app} · {row.operation} · {row.provider}
                            </span>
                            <span className="text-muted-foreground">
                              {row.events} event(s) · $$
                              {Number(row.provider_api_cost_usd).toFixed(6)} API · infra{" "}
                              {row.infrastructure_cost_status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Promotion workload telemetry</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Authenticated operational samples only. No prompts, content, user IDs, or
                          prices are exposed here; workload telemetry supports costing but does not
                          replace the sovereign cost ledger.
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {costing.data.promotionWorkload.total_samples} sample(s)
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {costing.data.promotionWorkload.apps.map((row) => (
                        <div
                          key={row.app}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 p-3 text-xs"
                        >
                          <span className="font-medium text-foreground">
                            {row.app.split("_").join(" ")}
                          </span>
                          <span className="text-muted-foreground">
                            {row.samples} sample(s) ·{" "}
                            {row.samples ? ((row.failures / row.samples) * 100).toFixed(1) : "0.0"}%
                            failures · avg {(row.avg_duration_ms / 1000).toFixed(1)}s · p95{" "}
                            {(row.p95_duration_ms / 1000).toFixed(1)}s
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4">
                    <p className="text-sm font-semibold">Authoritative external cost evidence</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {costing.data.adapterPolicy}
                    </p>
                    <div className="mt-3 space-y-3">
                      {costing.data.externalCostSources.map((source) => (
                        <div
                          key={source.key}
                          className="rounded-lg border border-border/70 p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{source.label}</span>
                            <span className="text-muted-foreground">
                              {source.status.split("_").join(" ")}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground">{source.evidence}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Authority: {source.authority}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="text-sm font-semibold">Costs still outside AI-broker telemetry</p>
                    <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                      {costing.data.gaps.map((gap) => (
                        <li key={gap}>• {gap}</li>
                      ))}
                    </ul>
                  </div>

                  <p className="text-xs text-muted-foreground">{costing.data.decision.note}</p>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Governed AI Council</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Choose one or more approved providers, submit one optimization request, and compare
                responses under the same RCGF instruction. Every successful provider response
                receives an append-only cost receipt.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(broker.data?.providers ?? []).map((p) => {
                  const available =
                    p.kind === "local" || (p.enabled && p.approved && p.secret_ready);
                  const checked = selectedProviders.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${available ? "border-border" : "border-border opacity-40"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={!available || (p.kind === "local" && checked)}
                        checked={checked}
                        onChange={(e) =>
                          setSelectedProviders((cur) =>
                            e.target.checked
                              ? [...new Set([...cur, p.id])]
                              : cur.filter((x) => x !== p.id),
                          )
                        }
                      />
                      <span>{p.name}</span>
                    </label>
                  );
                })}
              </div>
              {selectedProviders.some((id) => id !== "rons-local") && (
                <label className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <input
                    type="checkbox"
                    checked={approveExternalRun}
                    onChange={(e) => setApproveExternalRun(e.target.checked)}
                  />
                  <span>
                    I approve this external AI request and its provider cost for this run only. RONS
                    will not retain this approval for future runs.
                  </span>
                </label>
              )}
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Audit Sync Vision rendering flow and recommend the highest-impact local optimization"
                className="mt-4 min-h-28 w-full rounded-lg border border-border bg-background p-3 text-sm"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => council.mutate()}
                  disabled={
                    !prompt.trim() ||
                    council.isPending ||
                    selectedProviders.length === 0 ||
                    (selectedProviders.some((id) => id !== "rons-local") && !approveExternalRun)
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {council.isPending
                    ? "Consulting council…"
                    : `Run ${selectedProviders.length}-provider review`}
                </button>
                <span className="text-xs text-muted-foreground">
                  Selected: {selectedProviders.join(", ")}
                </span>
              </div>
              {council.error && (
                <p className="mt-3 text-sm text-red-400">{(council.error as Error).message}</p>
              )}
              {council.data && (
                <div className="mt-4 space-y-3">
                  {(council.data.results ?? []).map((r: CouncilResult) => (
                    <div
                      key={String(r.provider)}
                      className="rounded-lg border border-border bg-background p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <p className="font-semibold">{String(r.provider)}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.ok
                            ? `$${Number(r.cost_usd ?? 0).toFixed(6)} · ${String(r.latency_ms ?? 0)} ms · receipt ${String(r.receipt_id ?? "").slice(0, 10)}`
                            : "blocked / unavailable"}
                        </p>
                      </div>
                      <pre className="mt-3 whitespace-pre-wrap text-sm font-sans">
                        {r.ok ? String(r.text ?? "") : String(r.error ?? "No output")}
                      </pre>
                      {r.ok && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => promote.mutate(r)}
                            disabled={promote.isPending}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                          >
                            Promote to ROP
                          </button>
                          <span className="text-xs text-muted-foreground">
                            Creates pending proposal only; separate human approval required.
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="grid lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">Development council</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Recommended routing: local RONS first; use OpenAI/ChatGPT, Claude, Poe or another
                  provider only for a defined review task after approval. Compare outputs, preserve
                  evidence, then promote only the reviewed change.
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <Rule n="1" text="Local analysis and deterministic tests first" />
                  <Rule n="2" text="External AI receives minimum necessary context" />
                  <Rule n="3" text="No provider receives secrets or credential files" />
                  <Rule
                    n="4"
                    text="AI output is a proposal, never automatic production authority"
                  />
                  <Rule n="5" text="Version, test, audit and retain rollback evidence" />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-semibold">Promotion workspace</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  These are Resonance-owned destinations currently available for launch material.
                  Email fields are deliberately not invented; add only verified sender/contact
                  addresses.
                </p>
                <div className="mt-4 space-y-2">
                  {d.promotionSites.map((s) => (
                    <div key={s.url} className="rounded-lg border border-border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{s.name}</p>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            {s.url}
                          </a>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {s.email ?? "Email not verified/configured"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-semibold">Campaign launch guardrails</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Use consent-based, user-supplied or legitimately obtained business contacts. Keep
                unsubscribe/suppression handling, sender-domain authentication and delivery
                receipts. The existing Admin Email Queue and Email Domain tools remain the
                send/delivery control plane.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  to="/admin/emails"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Email Queue
                </Link>
                <Link
                  to="/admin/email-domain"
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                  Email Domain
                </Link>
                <Link
                  to="/admin/rop"
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                  Optimization Protocol
                </Link>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
function Rule({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-lg bg-background p-3">
      <span className="font-mono text-primary">{n}</span>
      <span>{text}</span>
    </div>
  );
}
