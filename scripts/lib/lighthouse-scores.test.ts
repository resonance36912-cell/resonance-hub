import { describe, expect, it } from "bun:test";
import {
  checkScores,
  formatReport,
  toBaseline,
  SCORE_FLOORS,
  LIGHTHOUSE_CATEGORIES,
  type Baseline,
} from "./lighthouse-scores";

const URL = "/apps/definitely-not-an-app-xyz";

const perfect: Record<string, Record<string, number>> = {
  [URL]: { performance: 0.99, accessibility: 1, "best-practices": 1, seo: 1 },
};

describe("checkScores floors", () => {
  it("passes with no baseline when every score clears its floor", () => {
    const res = checkScores(perfect, null);
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(LIGHTHOUSE_CATEGORIES.length);
    expect(res.rows.every((r) => r.baseline === null)).toBe(true);
  });

  it.each(LIGHTHOUSE_CATEGORIES)("fails when %s drops below its floor", (category) => {
    const measured = { [URL]: { ...perfect[URL], [category]: SCORE_FLOORS[category] - 0.01 } };
    const res = checkScores(measured, null);
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.category)).toEqual([category]);
    expect(res.failures[0]!.reason).toBe("below-floor");
  });

  it("accepts a score exactly on the floor", () => {
    const measured = { [URL]: { ...perfect[URL], performance: SCORE_FLOORS.performance } };
    expect(checkScores(measured, null).ok).toBe(true);
  });
});

describe("checkScores baseline regression", () => {
  const baseline: Baseline = {
    urls: { [URL]: { performance: 0.99, accessibility: 1, "best-practices": 1, seo: 1 } },
  };

  it("allows drift inside the tolerance", () => {
    const measured = { [URL]: { ...perfect[URL], performance: 0.97 } };
    expect(checkScores(measured, baseline, 0.03).ok).toBe(true);
  });

  it("fails on drift beyond the tolerance even when above the floor", () => {
    const measured = { [URL]: { ...perfect[URL], performance: 0.9 } };
    const res = checkScores(measured, baseline, 0.03);
    expect(res.ok).toBe(false);
    expect(res.failures[0]!.reason).toBe("regressed");
    expect(res.failures[0]!.limit).toBe(0.96);
  });

  it("uses the floor when it is stricter than baseline minus tolerance", () => {
    const low: Baseline = { urls: { [URL]: { accessibility: 0.95 } } };
    const res = checkScores({ [URL]: { accessibility: 0.93 } }, low, 0.03, ["accessibility"]);
    expect(res.rows[0]!.limit).toBe(SCORE_FLOORS.accessibility);
    expect(res.ok).toBe(false);
  });

  it("fails when a baselined URL or category disappears from the run", () => {
    const res = checkScores({}, baseline);
    expect(res.ok).toBe(false);
    expect(res.failures.every((f) => f.reason === "missing")).toBe(true);
  });
});

describe("reporting and baseline promotion", () => {
  it("renders measured, baseline, and limit columns", () => {
    const out = formatReport(checkScores(perfect, null));
    expect(out).toContain("performance");
    expect(out).toContain("accessibility");
    expect(out.split("\n").length).toBe(2 + LIGHTHOUSE_CATEGORIES.length);
  });

  it("rounds and sorts promoted baselines", () => {
    const promoted = toBaseline({ [URL]: { performance: 0.9349, seo: 1 } });
    expect(promoted.urls[URL]).toEqual({ performance: 0.93, seo: 1 });
    expect(promoted.updatedAt).toBeString();
  });
});
