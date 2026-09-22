import { createServerFn } from "@tanstack/react-start";
import { requireRonsAuth } from "@/lib/rons-auth-middleware";
import { fetchSovereignCostUsageSummary, hasBackendRole } from "@/lib/backend-provider.server";
import { fetchPromotionCostingSummary } from "@/lib/promotion-costing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FREE_PROMOTION, FREE_PROMOTION_ACTIVE } from "@/lib/promotion";

const BROKER = "http://127.0.0.1:7868";

type SpendWindow = {
  calls: number;
  cost_usd: number;
  by_provider: Record<string, { calls: number; cost_usd: number }>;
};

type ProviderRow = {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  approved: boolean;
  model?: string;
  secret_ready: boolean;
  input_usd_m?: number | null;
  cached_input_usd_m?: number | null;
  output_usd_m?: number | null;
  pricing_verified_at?: string;
  pricing_source?: string;
  free_tier?: boolean;
};

const COSTED_APPS = [
  { key: "epublisher", label: "Resonance ePublisher" },
  { key: "creative_studio", label: "Resonance Creative Studio" },
  { key: "sync_vision", label: "Resonance Sync Vision" },
  { key: "youtube_optimizer", label: "YouTube Optimizer" },
] as const;

const EXTERNAL_COST_SOURCES = [
  {
    key: "epublisher",
    label: "Resonance ePublisher",
    evidence: "api_usage_logs.cost_estimate",
    authority: "ePublisher backend",
    status: "source_identified_adapter_pending",
  },
  {
    key: "sync_vision",
    label: "Resonance Sync Vision",
    evidence:
      "generation_metrics.estimated_cost_usd; render_jobs/generation_jobs.estimated_cost_gbp",
    authority: "Sync Vision backend",
    status: "source_identified_adapter_pending",
  },
  {
    key: "creative_studio",
    label: "Resonance Creative Studio",
    evidence:
      "RONS v0.12 cost ledger + authenticated feature_usage promotion_costing via the source-authoritative spoke broker",
    authority: "RONS sovereign backend",
    status: "central_ledger_ready_workload_telemetry_live",
  },
  {
    key: "youtube_optimizer",
    label: "YouTube Optimizer",
    evidence:
      "RONS v0.12 /v1/ai/chat usage receipts + server-proxied feature_usage promotion_costing",
    authority: "RONS sovereign backend",
    status: "central_ledger_ready_workload_telemetry_live",
  },
] as const;

async function assertAdmin(userId: string) {
  if (!(await hasBackendRole(userId, "admin", supabaseAdmin))) {
    throw new Error("Forbidden: admin role required");
  }
}

async function brokerJson<T>(path: string): Promise<T> {
  const response = await fetch(BROKER + path, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`AI broker HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const getCostingStudy = createServerFn({ method: "GET" })
  .middleware([requireRonsAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    const [spendResult, healthResult, costResult, ledgerResult, workloadResult] =
      await Promise.allSettled([
        brokerJson<{ summary?: Record<string, SpendWindow> }>("/v1/spend"),
        brokerJson<{ providers?: ProviderRow[] }>("/health"),
        supabaseAdmin
          .from("sku_costs")
          .select("sku,cost_cents,currency,notes,updated_at")
          .order("sku", { ascending: true }),
        fetchSovereignCostUsageSummary(),
        fetchPromotionCostingSummary(),
      ]);

    const spend =
      spendResult.status === "fulfilled"
        ? ((spendResult.value?.summary ?? {}) as Record<string, SpendWindow>)
        : {};

    const providers =
      healthResult.status === "fulfilled"
        ? ((healthResult.value?.providers ?? []) as ProviderRow[])
        : [];

    const costRows =
      costResult.status === "fulfilled" && !costResult.value.error
        ? (costResult.value.data ?? [])
        : [];

    const sovereignCostLedger = ledgerResult.status === "fulfilled" ? ledgerResult.value : null;
    const sovereignLedgerAll = sovereignCostLedger?.all ?? {
      events: 0,
      costed_events: 0,
      provider_api_cost_usd: 0,
      rows: [],
    };

    const promotionWorkload =
      workloadResult.status === "fulfilled"
        ? workloadResult.value
        : {
            total_samples: 0,
            unknown_samples: 0,
            apps: COSTED_APPS.map((app) => ({
              app: app.key,
              samples: 0,
              successes: 0,
              failures: 0,
              cancelled: 0,
              avg_duration_ms: 0,
              p95_duration_ms: 0,
              input_units: 0,
              output_units: 0,
              input_bytes: 0,
              output_bytes: 0,
              by_operation: {},
              by_provider: {},
            })),
          };

    const appCoverage = COSTED_APPS.map((app) => {
      const rows = costRows.filter((row) => String(row.sku ?? "").startsWith(`${app.key}:`));
      const workload = promotionWorkload.apps.find((row) => row.app === app.key);
      return {
        ...app,
        configuredSkuCount: rows.length,
        hasManualCostAssumptions: rows.length > 0,
        promotionSamples: workload?.samples ?? 0,
        promotionFailures: workload?.failures ?? 0,
        promotionAvgDurationMs: workload?.avg_duration_ms ?? 0,
        promotionP95DurationMs: workload?.p95_duration_ms ?? 0,
      };
    });

    const activeProviders = providers.filter((provider) => provider.enabled || provider.approved);
    const unverifiedActiveProviders = activeProviders.filter(
      (provider) => !provider.pricing_verified_at || !provider.pricing_source,
    );

    const observed = spend.all ?? { calls: 0, cost_usd: 0, by_provider: {} };
    const gaps = [
      "Local hardware, electricity, depreciation, and maintenance are not included in AI-broker API spend.",
      "The v0.12 sovereign ledger records provider/runtime usage, but storage, bandwidth and local infrastructure costs still require measured operating inputs.",
      "Promotion workload telemetry measures demand, latency and failures; it is supporting evidence, not a provider-cost receipt or an automated price.",
      "Support time, operations, tax/VAT treatment, refunds, payment fees, and target margin remain business assumptions until explicitly entered.",
      "Zero provider spend during the promotion is evidence of the sovereign/free route in use; it is not, by itself, a complete customer-price basis.",
    ];

    return {
      generatedAt: new Date().toISOString(),
      promotion: {
        active: FREE_PROMOTION_ACTIVE,
        name: FREE_PROMOTION.name,
        startedOn: FREE_PROMOTION.startedOn,
        checkoutLocked: FREE_PROMOTION_ACTIVE,
      },
      observedSpend: spend,
      observedAllTime: observed,
      providers,
      activeProviderCount: activeProviders.length,
      unverifiedActiveProviderCount: unverifiedActiveProviders.length,
      manualCostAssumptions: costRows,
      appCoverage,
      externalCostSources: EXTERNAL_COST_SOURCES,
      sovereignCostLedger,
      sovereignLedgerAll,
      promotionWorkload,
      adapterPolicy:
        "RONS v0.12 remains the cost authority. Authenticated promotion workload telemetry adds demand/latency/failure evidence only; historical app-backend costs still require a read-only server adapter or signed governed export, and browser/anon credentials are never pricing evidence.",
      gaps,
      decision: {
        status: "costing_in_progress" as const,
        automatedPricingAllowed: false,
        note: "Public pricing remains disabled. Cost telemetry and assumptions are evidence only; re-enabling checkout requires a governed human pricing decision.",
      },
      sourceHealth: {
        aiBrokerSpend: spendResult.status === "fulfilled",
        aiBrokerProviders: healthResult.status === "fulfilled",
        skuCosts: costResult.status === "fulfilled" && !costResult.value.error,
        sovereignCostLedger: ledgerResult.status === "fulfilled",
        promotionWorkload: workloadResult.status === "fulfilled",
      },
    };
  });
