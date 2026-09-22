import { describe, expect, it } from "vitest";
import { summarizePromotionCostingRows } from "../../src/lib/promotion-costing";

describe("summarizePromotionCostingRows", () => {
  it("aggregates fixed promotion workload evidence without exposing raw metadata", () => {
    const summary = summarizePromotionCostingRows([
      {
        feature: "promotion_costing",
        metadata: {
          promotion: "free_access_costing",
          app: "creative_studio",
          operation: "analyze-content",
          provider: "sovereign_local",
          outcome: "success",
          duration_ms: 100,
          input_units: 1,
          output_units: 1,
          user_id: "must-not-be-returned",
          arbitrary_content: "must-not-be-returned",
        },
      },
      {
        feature: "promotion_costing",
        metadata: {
          promotion: "free_access_costing",
          app: "creative_studio",
          operation: "edit-poster",
          provider: "sovereign_local",
          outcome: "failure",
          duration_ms: 300,
        },
      },
      {
        feature: "promotion_costing",
        metadata: {
          promotion: "free_access_costing",
          source: "EpisodeAnalysis",
          operation: "episode_analysis",
          outcome: "success",
          duration_ms: 200,
        },
      },
      { feature: "other", metadata: { app: "creative_studio" } },
    ]);

    expect(summary.total_samples).toBe(3);
    expect(summary.unknown_samples).toBe(0);
    const creative = summary.apps.find((row) => row.app === "creative_studio")!;
    expect(creative).toMatchObject({
      samples: 2,
      successes: 1,
      failures: 1,
      avg_duration_ms: 200,
      p95_duration_ms: 300,
      input_units: 1,
      output_units: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("must-not-be-returned");
    expect(summary.apps.find((row) => row.app === "youtube_optimizer")?.samples).toBe(1);
  });

  it("counts unrecognized app samples without attributing them", () => {
    const summary = summarizePromotionCostingRows([
      {
        feature: "promotion_costing",
        metadata: {
          promotion: "free_access_costing",
          operation: "unknown",
          outcome: "success",
          duration_ms: 1,
        },
      },
    ]);
    expect(summary.total_samples).toBe(1);
    expect(summary.unknown_samples).toBe(1);
    expect(summary.apps.every((row) => row.samples === 0)).toBe(true);
  });
});
