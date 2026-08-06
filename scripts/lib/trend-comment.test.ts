import { describe, expect, it } from "vitest";
import { buildTrendComment, TREND_COMMENT_MARKER } from "./trend-comment";

const base = {
  status: "pass" as const,
  totals: { pass: 146, fail: 0, assertions: 4257 },
  baselineCommit: "abcdef1234567890",
  delta: { pass: 4, fail: 0, assertions: 120 },
  newFailures: [],
  counterexamples: { blocked: 27, leaked: 0, total: 27 },
  passSparkline: "▁▃▅▇",
  runs: 4,
  commit: "0123456789abcdef",
  runUrl: "https://github.com/o/r/actions/runs/9",
};

describe("buildTrendComment", () => {
  it("starts with the sticky marker", () => {
    expect(buildTrendComment(base).startsWith(TREND_COMMENT_MARKER)).toBe(true);
  });

  it("summarises a green run with signed deltas", () => {
    const md = buildTrendComment(base);
    expect(md).toContain("✅ all passing");
    expect(md).toContain("**146 passing**");
    expect(md).toContain("pass +4 · fail ±0 · assertions +120");
    expect(md).toContain("No new failures versus the baseline.");
    expect(md).toContain("27/27 blocked");
  });

  it("stays short", () => {
    expect(buildTrendComment(base).split("\n").length).toBeLessThan(20);
  });

  it("flags new failures with linked counterexample inputs", () => {
    const md = buildTrendComment({
      ...base,
      status: "fail",
      totals: { pass: 140, fail: 6, assertions: 4000 },
      delta: { pass: -6, fail: 6, assertions: -257 },
      newFailures: [{ title: "encoding", fail: 6 }],
      failureLinks: Array.from({ length: 7 }, (_, i) => ({
        label: `input ${i}`,
        url: `https://x/#cx-${i}`,
      })),
    });
    expect(md).toContain("❌ failing");
    expect(md).toContain("New failures:** encoding (6)");
    expect(md).toContain("[input 0](https://x/#cx-0)");
    expect(md).toContain("and 2 more");
    expect(md).not.toContain("[input 5]");
  });

  it("handles a missing baseline", () => {
    const md = buildTrendComment({ ...base, baselineCommit: null, delta: null });
    expect(md).toContain("this run becomes the baseline");
    expect(md).not.toContain("Δ vs");
  });

  it("warns about leaked counterexamples and removed suites", () => {
    const md = buildTrendComment({
      ...base,
      counterexamples: { blocked: 25, leaked: 2, total: 27 },
      removedSuites: ["cancel"],
    });
    expect(md).toContain("🔴 2 leaked");
    expect(md).toContain("Suites missing vs baseline: cancel");
  });
});
