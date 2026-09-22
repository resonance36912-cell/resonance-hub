import { describe, expect, test } from "bun:test";

const patterns = await import("../../src/lib/datanest/patterns").catch(() => null);
const migration = await Bun.file("supabase/migrations/20260920234000_datanest_patterns.sql").text().catch(() => "");

describe("DataNest deterministic patterns and trends", () => {
  test("classifies strengthening, weakening and resolved directions", () => {
    expect(patterns).not.toBeNull();
    if (!patterns) return;
    expect(patterns.classifyTrend({ previous: 2, current: 6, resolved: false })).toBe("strengthening");
    expect(patterns.classifyTrend({ previous: 6, current: 2, resolved: false })).toBe("weakening");
    expect(patterns.classifyTrend({ previous: 0, current: 0, resolved: true })).toBe("resolved");
  });

  test("maps first-pass operational categories deterministically", () => {
    expect(patterns).not.toBeNull();
    if (!patterns) return;
    expect(patterns.patternCategoryForEvent("ci.build.failed")).toBe("ci_build_deploy_failure");
    expect(patterns.patternCategoryForEvent("provider.quota.blocked")).toBe("provider_quota_limitation");
    expect(patterns.patternCategoryForEvent("fallback.succeeded")).toBe("fallback_success");
    expect(patterns.patternCategoryForEvent("runtime.exception")).toBe("runtime_exception");
    expect(patterns.patternCategoryForEvent("feature.requested")).toBe("feature_request");
    expect(patterns.patternCategoryForEvent("collaboration.preference")).toBe("collaboration_preference");
  });

  test("pattern storage retains evidence and keeps suggestions in review", () => {
    expect(migration).toContain("CREATE TABLE public.datanest_patterns");
    expect(migration).toContain("CREATE TABLE public.datanest_pattern_evidence");
    expect(migration).toContain("direction");
    expect(migration).toContain("review_status");
    expect(migration).toContain("TO service_role");
  });
});
