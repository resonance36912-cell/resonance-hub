/**
 * Historical trend tracking for the `return_to` coverage report.
 *
 * Each run appends one point to `history.json`, which travels forward through
 * CI artifacts: the workflow downloads the previous successful run's
 * `history.json` into `reports/return-to-coverage/baseline/`, this module
 * appends the current run, and the fresh file is re-uploaded. That gives a
 * rolling window of runs (capped at `HISTORY_LIMIT`) to chart pass/fail counts
 * and counterexample leakage over time — not just against the last run.
 */

export const HISTORY_LIMIT = 40;

export type CounterexampleStats = {
  /** Hostile inputs in the corpus. */
  total: number;
  /** Inputs correctly refused (signing or allowlist gate). */
  blocked: number;
  /** Inputs that would be ACCEPTED — must always be 0. */
  leaked: number;
};

export type HistoryPoint = {
  runId: string | null;
  runNumber: number | null;
  commit: string;
  branch: string | null;
  event: string | null;
  generatedAt: string;
  totals: { pass: number; fail: number; assertions: number };
  counterexamples: CounterexampleStats;
  /** Per-suite failure counts, for locating which suite regressed. */
  suites: { id: string; fail: number }[];
};

export type History = { points: HistoryPoint[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Parse a history file defensively — a corrupt or absent file yields no points. */
export function parseHistory(raw: string | null | undefined): History {
  if (!raw) return { points: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { points: [] };
  }
  if (!isRecord(data) || !Array.isArray(data.points)) return { points: [] };
  const points = data.points.filter(
    (p): p is HistoryPoint =>
      isRecord(p) && isRecord(p.totals) && typeof p.totals.pass === "number",
  );
  return { points };
}

/**
 * Append `point` to `history`, replacing any earlier entry for the same run
 * (re-runs) and trimming the window to the newest `limit` points.
 */
export function appendHistoryPoint(
  history: History,
  point: HistoryPoint,
  limit: number = HISTORY_LIMIT,
): History {
  const kept = history.points.filter(
    (p) => !(point.runId !== null && p.runId === point.runId),
  );
  const points = [...kept, point];
  return { points: points.slice(Math.max(0, points.length - limit)) };
}

/** Runs in the window that were red (failing tests or a leaked counterexample). */
export function findRegressions(history: History): HistoryPoint[] {
  return history.points.filter(
    (p) => p.totals.fail > 0 || p.counterexamples.leaked > 0,
  );
}

const SPARK = "▁▂▃▄▅▆▇█";

/** ASCII sparkline for the job log / PR comment. */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return "(no history)";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return SPARK[max === 0 ? 0 : 3]!.repeat(values.length);
  return values
    .map((v) => {
      const idx = Math.round(((v - min) / (max - min)) * (SPARK.length - 1));
      return SPARK[Math.min(SPARK.length - 1, Math.max(0, idx))]!;
    })
    .join("");
}

function escapeXml(v: string): string {
  return v.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;",
  );
}

/**
 * Inline SVG chart: a line for a "good" series (passing tests / blocked
 * counterexamples) and red bars for a "bad" series (failing tests / leaks).
 * Inline so the HTML report and its printed PDF stay self-contained.
 */
export function renderHistoryChart(options: {
  title: string;
  points: readonly HistoryPoint[];
  good: (p: HistoryPoint) => number;
  bad: (p: HistoryPoint) => number;
  goodLabel: string;
  badLabel: string;
}): string {
  const { title, points, good, bad, goodLabel, badLabel } = options;
  if (points.length === 0) {
    return `<figure class="chart"><figcaption>${escapeXml(title)}</figcaption><p class="sub">No history yet — this run seeds the series.</p></figure>`;
  }

  const W = 720;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const goods = points.map(good);
  const bads = points.map(bad);
  const maxGood = Math.max(1, ...goods);
  const maxBad = Math.max(1, ...bads);
  const n = points.length;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yGood = (v: number) => PAD.top + plotH - (v / maxGood) * plotH;
  const barW = Math.max(2, Math.min(18, plotW / Math.max(1, n) - 2));

  const line = goods.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yGood(v).toFixed(1)}`).join(" ");

  const bars = bads
    .map((v, i) => {
      if (v <= 0) return "";
      const h = Math.max(3, (v / maxBad) * plotH);
      return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${(PAD.top + plotH - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#dc2626" opacity="0.75"><title>${escapeXml(
        `${points[i]!.commit.slice(0, 8)} — ${badLabel}: ${v}`,
      )}</title></rect>`;
    })
    .join("");

  const dots = goods
    .map(
      (v, i) =>
        `<circle cx="${x(i).toFixed(1)}" cy="${yGood(v).toFixed(1)}" r="3" fill="#2563eb"><title>${escapeXml(
          `${points[i]!.commit.slice(0, 8)} (${points[i]!.generatedAt}) — ${goodLabel}: ${v}, ${badLabel}: ${bads[i]}`,
        )}</title></circle>`,
    )
    .join("");

  const firstLabel = escapeXml(points[0]!.commit.slice(0, 8));
  const lastLabel = escapeXml(points[n - 1]!.commit.slice(0, 8));

  return `<figure class="chart">
  <figcaption>${escapeXml(title)} — <span style="color:#2563eb">${escapeXml(goodLabel)}</span> vs <span style="color:#dc2626">${escapeXml(badLabel)}</span> across the last ${n} run(s)</figcaption>
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${escapeXml(`${title} over ${n} runs`)}">
    <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${W - PAD.right}" y2="${PAD.top + plotH}" stroke="#cbd5e1" />
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="#cbd5e1" />
    <text x="4" y="${PAD.top + 10}" font-size="10" fill="#64748b">${maxGood}</text>
    <text x="4" y="${PAD.top + plotH}" font-size="10" fill="#64748b">0</text>
    ${bars}
    <path d="${line}" fill="none" stroke="#2563eb" stroke-width="2" />
    ${dots}
    <text x="${PAD.left}" y="${H - 8}" font-size="10" fill="#64748b">${firstLabel}</text>
    <text x="${W - PAD.right}" y="${H - 8}" font-size="10" fill="#64748b" text-anchor="end">${lastLabel}</text>
  </svg>
</figure>`;
}

/** Markdown block (job summary + PR comment) with sparklines and regressions. */
export function renderHistoryMarkdown(history: History): string[] {
  const pts = history.points;
  if (pts.length <= 1) {
    return [
      "#### Historical trend",
      "",
      "_Not enough history yet — charts appear once a second run is recorded._",
    ];
  }
  const regressions = findRegressions(history);
  const window = pts.slice(-12);
  return [
    `#### Historical trend (last ${pts.length} run(s))`,
    "",
    "| Series | Trend | Latest |",
    "| --- | --- | ---: |",
    `| Passing tests | \`${sparkline(pts.map((p) => p.totals.pass))}\` | ${pts.at(-1)!.totals.pass} |`,
    `| Failing tests | \`${sparkline(pts.map((p) => p.totals.fail))}\` | ${pts.at(-1)!.totals.fail} |`,
    `| Assertions | \`${sparkline(pts.map((p) => p.totals.assertions))}\` | ${pts.at(-1)!.totals.assertions.toLocaleString("en-US")} |`,
    `| Counterexamples blocked | \`${sparkline(pts.map((p) => p.counterexamples.blocked))}\` | ${pts.at(-1)!.counterexamples.blocked}/${pts.at(-1)!.counterexamples.total} |`,
    `| Counterexamples leaked | \`${sparkline(pts.map((p) => p.counterexamples.leaked))}\` | ${pts.at(-1)!.counterexamples.leaked} |`,
    "",
    regressions.length
      ? `> ⚠️ **${regressions.length} red run(s) in the window:** ${regressions
          .slice(-5)
          .map((p) => `\`${p.commit.slice(0, 8)}\` (${p.totals.fail} failing, ${p.counterexamples.leaked} leaked)`)
          .join(", ")}`
      : "No red runs in the recorded window.",
    "",
    `<sub>Window: \`${window[0]!.commit.slice(0, 8)}\` → \`${window.at(-1)!.commit.slice(0, 8)}\`. Full charts are in the HTML/PDF report artifact.</sub>`,
  ];
}
