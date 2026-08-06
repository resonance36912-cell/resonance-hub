#!/usr/bin/env bun
/**
 * Build a historical pass/fail + failure-rate graph from uploaded
 * `summary.json` files and publish it to the run-summary page.
 *
 * Usage:
 *   bun run scripts/return-to-history-graph.ts [paths...] [--suites=a,b]
 *
 * Defaults to `reports/return-to-coverage/summaries` (where CI downloads
 * previous runs' summary artifacts). `--suites` (or RETURN_TO_HISTORY_SUITES)
 * restricts the series to a subset of suites; the HTML chart additionally ships
 * interactive per-suite checkboxes so the filter can be changed while reading.
 * Writes:
 *   reports/return-to-coverage/history-graph.svg   — standalone chart
 *   reports/return-to-coverage/history-graph.html  — chart + filters + table
 *   reports/return-to-coverage/history-graph.md    — markdown block
 * and appends the markdown to $GITHUB_STEP_SUMMARY when running in Actions.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  applySuiteFilter,
  collectSummaryHistory,
  failureRate,
  findSummaryFiles,
  hasSuiteBreakdown,
  listSuiteIds,
  parseSuiteFilter,
  renderFailureRateChart,
  renderSuiteFilterChart,
  renderSummaryHistoryMarkdown,
  suiteTotals,
  SUITE_FILTER_CSS,
} from "./lib/summary-history";

const OUT_DIR = join(process.cwd(), "reports", "return-to-coverage");
const DEFAULT_INPUT = join(OUT_DIR, "summaries");

const args = process.argv.slice(2);
const suiteFlag =
  args.find((a) => a.startsWith("--suites="))?.slice("--suites=".length) ??
  process.env["RETURN_TO_HISTORY_SUITES"] ??
  null;
const inputs = args.filter((a) => !a.startsWith("--"));
const paths = inputs.length ? inputs : [DEFAULT_INPUT];

const files = findSummaryFiles(paths);
const { history, skipped } = collectSummaryHistory(files);
const allSuites = listSuiteIds(history.points);
const { selected, unknown } = parseSuiteFilter(suiteFlag, allSuites);
if (unknown.length) {
  console.warn(`Ignoring unknown suite id(s): ${unknown.join(", ")}`);
}
const filterable = hasSuiteBreakdown(history.points);
if (selected && !filterable) {
  console.warn(
    "Uploaded summaries have no per-suite pass counts — charting run totals for all suites instead.",
  );
}
const breakdown = suiteTotals(history.points);
const filteredPoints = applySuiteFilter(history.points, selected);
const staticChart = renderFailureRateChart(filteredPoints);
const interactiveChart = renderSuiteFilterChart(history.points, {
  selected,
  idPrefix: "history",
});
const markdown = renderSummaryHistoryMarkdown(
  { points: filteredPoints },
  {
    sources: files.length,
    skipped: skipped.length,
    artifact: "return-to-coverage-report/history-graph.html",
    selected,
    allSuites,
    breakdown,
  },
).join("\n");

mkdirSync(OUT_DIR, { recursive: true });
const svg = staticChart.match(/<svg[\s\S]*<\/svg>/)?.[0] ?? "";
writeFileSync(join(OUT_DIR, "history-graph.svg"), `${svg}\n`);
writeFileSync(join(OUT_DIR, "history-graph.md"), `${markdown}\n`);
writeFileSync(
  join(OUT_DIR, "history-graph.html"),
  `<!doctype html>
<meta charset="utf-8" />
<title>return_to coverage — historical pass/fail &amp; failure rate</title>
<style>
  body { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 32px; color: #0f172a; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #64748b; font-size: 12px; }
  figure { margin: 20px 0; }
  figcaption { font-size: 12px; color: #475569; margin-bottom: 6px; }
  table { border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th, td { border: 1px solid #e2e8f0; padding: 5px 10px; text-align: right; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
  tr.red td { background: #fef2f2; }
${SUITE_FILTER_CSS}
</style>
<h1>return_to coverage — historical pass/fail &amp; failure rate</h1>
<p class="sub">${history.points.length} run(s) from ${files.length} uploaded summary file(s)${
    skipped.length ? `, ${skipped.length} skipped as unreadable/not a summary` : ""
  }${
    selected && filterable
      ? `. Initial suite filter: ${selected.map((s) => `<code>${s}</code>`).join(", ")}`
      : ""
  }.</p>
${interactiveChart}
<table>
  <thead><tr><th>Run</th><th>Generated</th><th>Pass</th><th>Fail</th><th>Assertions</th><th>Failure rate</th></tr></thead>
  <tbody>
    ${filteredPoints
      .map(
        (p) =>
          `<tr class="${p.totals.fail > 0 ? "red" : ""}"><td><code>${p.commit.slice(0, 12)}</code></td><td>${
            p.generatedAt || "—"
          }</td><td>${p.totals.pass}</td><td>${p.totals.fail}</td><td>${p.totals.assertions.toLocaleString(
            "en-US",
          )}</td><td>${failureRate(p).toFixed(2)}%</td></tr>`,
      )
      .join("\n    ")}
  </tbody>
</table>
${
  breakdown.length
    ? `<h2 style="font-size:15px">Per-suite contribution</h2>
<table>
  <thead><tr><th>Suite</th><th>Runs</th><th>Pass</th><th>Fail</th></tr></thead>
  <tbody>
    ${breakdown
      .map(
        (s) =>
          `<tr><td><code>${s.id}</code></td><td>${s.runs}</td><td>${s.pass}</td><td>${s.fail}</td></tr>`,
      )
      .join("\n    ")}
  </tbody>
</table>`
    : ""
}
`,
);

const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile) appendFileSync(summaryFile, `\n${markdown}\n`);

console.log(markdown);
console.log(
  `\nSummary files scanned: ${files.length} (${skipped.length} skipped) · points charted: ${filteredPoints.length} · suites: ${
    allSuites.length ? allSuites.join(", ") : "none recorded"
  }${selected && filterable ? ` · filter: ${selected.join(", ")}` : ""}`,
);
console.log(`Chart: ${join(OUT_DIR, "history-graph.html")}`);

