import { getBackendProvider } from "@/lib/backend-provider.server";
import {
  summarizePromotionCostingRows,
  type PromotionCostingRawRow,
  type PromotionWorkloadSummary,
} from "@/lib/promotion-costing";

const DEFAULT_SOVEREIGN_GATEWAY = "http://127.0.0.1:58600";

function sovereignGatewayUrl(): string {
  return (process.env.RESONANCE_SOVEREIGN_GATEWAY_URL ?? DEFAULT_SOVEREIGN_GATEWAY).replace(
    /\/$/,
    "",
  );
}

async function sovereignDbQuery<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${sovereignGatewayUrl()}/v1/db/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Sovereign database request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchPromotionCostingSummary(): Promise<PromotionWorkloadSummary> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Promotion costing workload requires sovereign backend mode");
  }

  const rows = await sovereignDbQuery<PromotionCostingRawRow[]>({
    table: "feature_usage",
    action: "select",
    columns: "feature,metadata,created_at",
    filters: [{ column: "feature", op: "eq", value: "promotion_costing" }],
    options: { order: { column: "created_at", ascending: false }, limit: 10000 },
  });

  return summarizePromotionCostingRows(rows);
}
