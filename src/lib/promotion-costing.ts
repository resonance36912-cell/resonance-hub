export const PROMOTION_COSTING_APPS = [
  "epublisher",
  "creative_studio",
  "sync_vision",
  "youtube_optimizer",
] as const;

export type PromotionCostingApp = (typeof PROMOTION_COSTING_APPS)[number];

export type PromotionCostingRawRow = {
  feature?: unknown;
  metadata?: unknown;
  created_at?: unknown;
};

export type PromotionWorkloadAppSummary = {
  app: PromotionCostingApp;
  samples: number;
  successes: number;
  failures: number;
  cancelled: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  input_units: number;
  output_units: number;
  input_bytes: number;
  output_bytes: number;
  by_operation: Record<string, number>;
  by_provider: Record<string, number>;
};

export type PromotionWorkloadSummary = {
  total_samples: number;
  unknown_samples: number;
  apps: PromotionWorkloadAppSummary[];
};

const APP_SET = new Set<string>(PROMOTION_COSTING_APPS);

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function inferApp(metadata: Record<string, unknown>): PromotionCostingApp | null {
  const direct = typeof metadata["app"] === "string" ? metadata["app"] : "";
  if (APP_SET.has(direct)) return direct as PromotionCostingApp;

  const source = typeof metadata["source"] === "string" ? metadata["source"] : "";
  if (["useAudit", "EpisodeAnalysis", "VideoScoreAnalyzer"].includes(source)) {
    return "youtube_optimizer";
  }
  return null;
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0);
}

export function summarizePromotionCostingRows(rows: PromotionCostingRawRow[]): PromotionWorkloadSummary {
  const buckets = new Map<PromotionCostingApp, {
    durations: number[];
    successes: number;
    failures: number;
    cancelled: number;
    input_units: number;
    output_units: number;
    input_bytes: number;
    output_bytes: number;
    by_operation: Record<string, number>;
    by_provider: Record<string, number>;
  }>();
  for (const app of PROMOTION_COSTING_APPS) {
    buckets.set(app, {
      durations: [],
      successes: 0,
      failures: 0,
      cancelled: 0,
      input_units: 0,
      output_units: 0,
      input_bytes: 0,
      output_bytes: 0,
      by_operation: {},
      by_provider: {},
    });
  }

  let totalSamples = 0;
  let unknownSamples = 0;
  for (const row of rows) {
    if (row.feature !== "promotion_costing") continue;
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};
    if (metadata["promotion"] !== "free_access_costing") continue;

    totalSamples += 1;
    const app = inferApp(metadata);
    if (!app) {
      unknownSamples += 1;
      continue;
    }
    const bucket = buckets.get(app)!;
    const duration = numberValue(metadata["duration_ms"]);
    bucket.durations.push(duration);

    const outcome = metadata["outcome"];
    if (outcome === "success") bucket.successes += 1;
    else if (outcome === "failure") bucket.failures += 1;
    else if (outcome === "cancelled") bucket.cancelled += 1;

    bucket.input_units += numberValue(metadata["input_units"]);
    bucket.output_units += numberValue(metadata["output_units"]);
    bucket.input_bytes += numberValue(metadata["input_bytes"]);
    bucket.output_bytes += numberValue(metadata["output_bytes"]);

    const operation = typeof metadata["operation"] === "string" ? metadata["operation"] : "unknown";
    bucket.by_operation[operation] = (bucket.by_operation[operation] ?? 0) + 1;
    const provider = typeof metadata["provider"] === "string" ? metadata["provider"] : "unknown";
    bucket.by_provider[provider] = (bucket.by_provider[provider] ?? 0) + 1;
  }

  return {
    total_samples: totalSamples,
    unknown_samples: unknownSamples,
    apps: PROMOTION_COSTING_APPS.map((app) => {
      const bucket = buckets.get(app)!;
      const samples = bucket.durations.length;
      return {
        app,
        samples,
        successes: bucket.successes,
        failures: bucket.failures,
        cancelled: bucket.cancelled,
        avg_duration_ms: samples
          ? Math.round(bucket.durations.reduce((sum, value) => sum + value, 0) / samples)
          : 0,
        p95_duration_ms: percentile95(bucket.durations),
        input_units: bucket.input_units,
        output_units: bucket.output_units,
        input_bytes: bucket.input_bytes,
        output_bytes: bucket.output_bytes,
        by_operation: bucket.by_operation,
        by_provider: bucket.by_provider,
      };
    }),
  };
}
