import { getBackendProvider } from "@/lib/backend-provider.server";
import {
  summarizePromotionCostingRows,
  type PromotionCostingRawRow,
  type PromotionWorkloadSummary,
} from "@/lib/promotion-costing";

const DEFAULT_SOVEREIGN_GATEWAY = "http://127.0.0.1:58600";

function promotionCostingQueryUrl(): URL {
  const configured = process.env.RESONANCE_SOVEREIGN_GATEWAY_URL?.trim() || DEFAULT_SOVEREIGN_GATEWAY;
  const base = new URL(configured);
  const loopback =
    base.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if (!loopback) {
    throw new Error("Promotion costing gateway must be loopback HTTP");
  }
  return new URL("/v1/db/query", base);
}

export async function fetchPromotionCostingSummary(): Promise<PromotionWorkloadSummary> {
  if (getBackendProvider() !== "sovereign") {
    throw new Error("Promotion costing workload requires sovereign backend mode");
  }

  const response = await fetch(promotionCostingQueryUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "error",
    body: JSON.stringify({
      table: "feature_usage",
      action: "select",
      columns: "feature,metadata,created_at",
      filters: [{ column: "feature", op: "eq", value: "promotion_costing" }],
      options: { order: { column: "created_at", ascending: false }, limit: 10000 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Promotion costing workload lookup failed (${response.status})`);
  }
  const rows = (await response.json()) as PromotionCostingRawRow[];
  return summarizePromotionCostingRows(rows);
}
