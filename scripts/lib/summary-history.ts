/**
 * Historical graph built from uploaded `summary.json` files.
 *
 * `coverage-history.ts` tracks a rolling window inside a single CI artifact
 * chain. This module covers the other direction: point it at a folder of
 * `summary.json` files (downloaded artifacts, archived runs, files a human
 * uploaded) and it reconstructs a chronological series so the run-summary page
 * can show pass/fail counts and the failure rate over time.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CounterexampleStats, History, HistoryPoint } from "./coverage-history";
import { sparkline } from "./coverage-history";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Convert one `summary.json` document into a history point. Returns null when
 * the file is not a coverage summary (missing totals), so unrelated JSON in the
 * upload folder is skipped rather than charted as zeroes.
 */
export function parseSummaryPoint(raw: string, sourceLabel = "upload"): HistoryPoint | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || !isRecord(data.totals) || typeof data.totals.pass !== "number") {
    return null;
  }
  const cx = isRecord(data.counterexamples) ? data.counterexamples : {};
  const counterexamples: CounterexampleStats = {
    total: num(cx.total),
    blocked: num(cx.blocked),
    leaked: num(cx.leaked),
  };
  const suites = Array.isArray(data.suites)
    ? data.suites
        .filter(isRecord)
        .map((s) => ({ id: str(s.id) ?? "unknown", fail: num(s.fail) }))
    : [];
  return {
    runId: str(data.runId),
    runNumber: typeof data.runNumber === "number" ? data.runNumber : null,
    commit: str(data.commit) ?? sourceLabel,
    branch: str(data.branch),
    event: str(data.event),
    generatedAt: str(data.generatedAt) ?? str(data.Generated) ?? "",
    totals: {
      pass: num(data.totals.pass),
      fail: num(data.totals.fail),
      assertions: num(data.totals.assertions),
    },
    counterexamples,
    suites,
  };
}

/** Recursively collect `*summary*.json` files under the given paths. */
export function findSummaryFiles(paths: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(p).sort()) walk(join(p, entry));
    } else if (/\.json$/i.test(p)) {
      found.push(p);
    }
  };
  for (const p of paths) walk(p);
  return found;
}

/**
 * Build a chronological history from summary files. Points are ordered by
 * `generatedAt` (falling back to file order), and duplicates for the same run
 * or commit+timestamp are collapsed so re-downloaded artifacts don't double up.
 */
export function collectSummaryHistory(files: readonly string[]): {
  history: History;
  skipped: string[];
} {
  const points: HistoryPoint[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      skipped.push(file);
      continue;
    }
    const point = parseSummaryPoint(raw, file);
    if (!point) {
      skipped.push(file);
      continue;
    }
    const key = point.runId ?? `${point.commit}@${point.generatedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(point);
  }
  points.sort((a, b) => (a.generatedAt ?? "").localeCompare(b.generatedAt ?? ""));
  return { history: { points }, skipped };
}

/** Failing tests as a percentage of executed tests (0 when nothing ran). */
export function failureRate(point: HistoryPoint): number {
  const total = point.totals.pass + point.totals.fail;
  return total === 0 ? 0 : (point.totals.fail / total) * 100;
}

function escapeXml(v: string): string {
  return v.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;",
  );
}

const shortLabel = (p: HistoryPoint): string =>
  (p.commit.includes("/") ? p.commit.split("/").pop()! : p.commit).slice(0, 10);

/**
 * Inline SVG: pass/fail bars plus a failure-rate line, self-contained so it can
 * be embedded in the run-summary page, the HTML report, and the printed PDF.
 */
export function renderFailureRateChart(points: readonly HistoryPoint[], title = "Pass / fail and failure rate over time"): string {
  if (points.length === 0) {
    return `<figure class="chart"><figcaption>${escapeXml(title)}</figcaption><p class="sub">No summary.json files found — upload at least one to chart history.</p></figure>`;
  }
  const W = 720;
  const H = 220;
  const PAD = { top: 18, right: 44, bottom: 30, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const maxTests = Math.max(1, ...points.map((p) => p.totals.pass + p.totals.fail));
  const rates = points.map(failureRate);
  const maxRate = Math.max(1, ...rates);
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(26, slot * 0.6));
  const cx = (i: number) => PAD.left + slot * (i + 0.5);
  const yTests = (v: number) => PAD.top + plotH - (v / maxTests) * plotH;
  const yRate = (v: number) => PAD.top + plotH - (v / maxRate) * plotH;

  const bars = points
    .map((p, i) => {
      const passH = (p.totals.pass / maxTests) * plotH;
      const failH = (p.totals.fail / maxTests) * plotH;
      const x = cx(i) - barW / 2;
      const passY = PAD.top + plotH - passH;
      const failY = passY - failH;
      const tip = escapeXml(
        `${shortLabel(p)} — pass ${p.totals.pass}, fail ${p.totals.fail}, failure rate ${failureRate(p).toFixed(2)}%`,
      );
      return `<g><rect x="${x.toFixed(1)}" y="${passY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, passH).toFixed(1)}" fill="#16a34a" opacity="0.75" /><rect x="${x.toFixed(1)}" y="${failY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, failH).toFixed(1)}" fill="#dc2626" /><title>${tip}</title></g>`;
    })
    .join("");

  const line = rates
    .map((v, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${yRate(v).toFixed(1)}`)
    .join(" ");
  const dots = rates
    .map(
      (v, i) =>
        `<circle cx="${cx(i).toFixed(1)}" cy="${yRate(v).toFixed(1)}" r="3" fill="#b45309"><title>${escapeXml(
          `${shortLabel(points[i]!)} — failure rate ${v.toFixed(2)}%`,
        )}</title></circle>`,
    )
    .join("");

  return `<figure class="chart">
  <figcaption>${escapeXml(title)} — <span style="color:#16a34a">passing</span> / <span style="color:#dc2626">failing</span> tests with <span style="color:#b45309">failure rate</span> across ${n} run(s)</figcaption>
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${escapeXml(`${title} over ${n} runs`)}">
    <line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${W - PAD.right}" y2="${PAD.top + plotH}" stroke="#cbd5e1" />
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top + plotH}" stroke="#cbd5e1" />
    <text x="4" y="${PAD.top + 10}" font-size="10" fill="#64748b">${maxTests}</text>
    <text x="4" y="${PAD.top + plotH}" font-size="10" fill="#64748b">0</text>
    <text x="${W - PAD.right + 6}" y="${PAD.top + 10}" font-size="10" fill="#b45309">${maxRate.toFixed(1)}%</text>
    <text x="${W - PAD.right + 6}" y="${PAD.top + plotH}" font-size="10" fill="#b45309">0%</text>
    ${bars}
    <path d="${line}" fill="none" stroke="#b45309" stroke-width="2" stroke-dasharray="4 3" />
    ${dots}
    <text x="${PAD.left}" y="${H - 8}" font-size="10" fill="#64748b">${escapeXml(shortLabel(points[0]!))}</text>
    <text x="${W - PAD.right}" y="${H - 8}" font-size="10" fill="#64748b" text-anchor="end">${escapeXml(shortLabel(points[n - 1]!))}</text>
  </svg>
</figure>`;
}

/**
 * Markdown for the run-summary page (`$GITHUB_STEP_SUMMARY`): sparklines plus a
 * compact per-run table. GitHub strips inline SVG from step summaries, so the
 * chart itself ships in the HTML/PDF artifact and this is the textual view.
 */
export function renderSummaryHistoryMarkdown(
  history: History,
  opts: { sources?: number; skipped?: number; artifact?: string | null } = {},
): string[] {
  const pts = history.points;
  if (pts.length === 0) {
    return [
      "#### Uploaded summary history",
      "",
      "_No usable `summary.json` uploads found — nothing to chart._",
    ];
  }
  const rates = pts.map(failureRate);
  const latest = pts.at(-1)!;
  const window = pts.slice(-12);
  return [
    `#### Uploaded summary history (${pts.length} run(s)${
      opts.skipped ? `, ${opts.skipped} file(s) skipped` : ""
    })`,
    "",
    "| Series | Trend | Latest |",
    "| --- | --- | ---: |",
    `| Passing tests | \`${sparkline(pts.map((p) => p.totals.pass))}\` | ${latest.totals.pass} |`,
    `| Failing tests | \`${sparkline(pts.map((p) => p.totals.fail))}\` | ${latest.totals.fail} |`,
    `| Failure rate | \`${sparkline(rates)}\` | ${rates.at(-1)!.toFixed(2)}% |`,
    "",
    "| Run | Date | Pass | Fail | Failure rate |",
    "| --- | --- | ---: | ---: | ---: |",
    ...window.map(
      (p) =>
        `| \`${shortLabel(p)}\` | ${p.generatedAt || "—"} | ${p.totals.pass} | ${p.totals.fail} | ${failureRate(
          p,
        ).toFixed(2)}%${p.totals.fail > 0 ? " 🔴" : ""} |`,
    ),

    "",
    opts.artifact
      ? `<sub>Chart (SVG) is in \`${opts.artifact}\` on this run.</sub>`
      : "<sub>Chart (SVG) ships with the coverage report artifact.</sub>",
  ];
}
