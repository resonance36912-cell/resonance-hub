/**
 * Lighthouse score gate — pure comparison logic.
 *
 * Two independent gates per category:
 *
 *   1. Absolute floor  — the score must never drop below the committed
 *      minimum, even on a first run with no baseline.
 *   2. Regression gate — the score must not fall more than `tolerance`
 *      below the recorded baseline, so a slow slide of 0.95 -> 0.86 fails
 *      long before it crosses the floor.
 *
 * Kept free of I/O so it is unit-testable with `bun test`.
 */

export const LIGHTHOUSE_CATEGORIES = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
] as const;

export type LighthouseCategory = (typeof LIGHTHOUSE_CATEGORIES)[number];

export type CategoryScores = Partial<Record<LighthouseCategory, number>>;

/** Absolute floors. A build fails when any measured score lands below these. */
export const SCORE_FLOORS: Record<LighthouseCategory, number> = {
  performance: 0.85,
  accessibility: 0.95,
  "best-practices": 0.9,
  seo: 0.9,
};

/** How far below baseline a score may drift before it counts as a regression. */
export const DEFAULT_TOLERANCE = 0.03;

export type Baseline = {
  /** Per-URL, per-category scores from the last promoted run. */
  urls: Record<string, CategoryScores>;
  updatedAt?: string;
  note?: string;
};

export type CheckRow = {
  url: string;
  category: LighthouseCategory;
  measured: number;
  floor: number;
  baseline: number | null;
  /** Lowest value accepted: max(floor, baseline - tolerance). */
  limit: number;
  ok: boolean;
  reason: "ok" | "below-floor" | "regressed" | "missing";
};

export type CheckResult = {
  rows: CheckRow[];
  failures: CheckRow[];
  ok: boolean;
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compare a run's scores against the floors and the baseline.
 *
 * A category present in the baseline but missing from the run is a failure —
 * a silently dropped audit must not read as "no regression".
 */
export function checkScores(
  measured: Record<string, CategoryScores>,
  baseline: Baseline | null,
  tolerance: number = DEFAULT_TOLERANCE,
  categories: readonly LighthouseCategory[] = LIGHTHOUSE_CATEGORIES
): CheckResult {
  const rows: CheckRow[] = [];
  const urls = new Set<string>([
    ...Object.keys(measured),
    ...Object.keys(baseline?.urls ?? {}),
  ]);

  for (const url of [...urls].sort()) {
    for (const category of categories) {
      const base = baseline?.urls?.[url]?.[category];
      const baselineScore = typeof base === "number" ? base : null;
      const floor = SCORE_FLOORS[category];
      const limit = round2(
        baselineScore === null ? floor : Math.max(floor, baselineScore - tolerance)
      );
      const value = measured[url]?.[category];

      if (typeof value !== "number") {
        rows.push({
          url,
          category,
          measured: Number.NaN,
          floor,
          baseline: baselineScore,
          limit,
          ok: false,
          reason: "missing",
        });
        continue;
      }

      const score = round2(value);
      const belowFloor = score < floor;
      const regressed =
        baselineScore !== null && score < round2(baselineScore - tolerance);
      rows.push({
        url,
        category,
        measured: score,
        floor,
        baseline: baselineScore,
        limit,
        ok: !belowFloor && !regressed,
        reason: belowFloor ? "below-floor" : regressed ? "regressed" : "ok",
      });
    }
  }

  const failures = rows.filter((r) => !r.ok);
  return { rows, failures, ok: failures.length === 0 };
}

/** Fixed-width report so CI logs show measured vs limit at a glance. */
export function formatReport(result: CheckResult): string {
  const head = [
    "url                                      category         score  baseline  limit  status",
    "---------------------------------------------------------------------------------------",
  ];
  const body = result.rows.map((r) => {
    const url = r.url.length > 40 ? "…" + r.url.slice(-39) : r.url.padEnd(40);
    const score = Number.isNaN(r.measured) ? "  n/a" : r.measured.toFixed(2);
    const base = r.baseline === null ? "   —" : r.baseline.toFixed(2);
    return [
      url.padEnd(40),
      r.category.padEnd(16),
      score.padStart(5),
      base.padStart(9),
      r.limit.toFixed(2).padStart(6),
      "  " + (r.ok ? "ok" : r.reason.toUpperCase()),
    ].join(" ");
  });
  return [...head, ...body].join("\n");
}

/** Build the baseline document to commit after a green run. */
export function toBaseline(
  measured: Record<string, CategoryScores>,
  note?: string
): Baseline {
  const urls: Record<string, CategoryScores> = {};
  for (const url of Object.keys(measured).sort()) {
    const scores: CategoryScores = {};
    for (const category of LIGHTHOUSE_CATEGORIES) {
      const value = measured[url]?.[category];
      if (typeof value === "number") scores[category] = round2(value);
    }
    urls[url] = scores;
  }
  return { urls, updatedAt: new Date().toISOString(), note };
}
