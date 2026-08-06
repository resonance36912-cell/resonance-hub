#!/usr/bin/env bun
/**
 * Build a historical pass/fail + failure-rate graph from uploaded
 * `summary.json` files and publish it to the run-summary page.
 *
 * Usage:
 *   bun run scripts/return-to-history-graph.ts [paths...]
 *
 * Defaults to `reports/return-to-coverage/summaries` (where CI downloads
 * previous runs' summary artifacts). Writes:
 *   reports/return-to-coverage/history-graph.svg   — standalone chart
 *   reports/return-to-coverage/history-graph.html  — chart + per-run table
 *   reports/return-to-coverage/history-graph.md    — markdown block
 * and appends the markdown to $GITHUB_STEP_SUMMARY when running in Actions.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectSummaryHistory,
  failureRate,
  findSummaryFiles,
  renderFailureRateChart,
  renderSummaryHistoryMarkdown,
} from "./lib/summary-history";

const OUT_DIR = join(process.cwd(), "reports", "return-to-coverage");
const DEFAULT_INPUT = join(OUT_DIR, "summaries");

const inputs = process.argv.slice(2);
const paths = inputs.length ? inputs : [DEFAULT_INPUT];

const files = findSummaryFiles(paths);
const { history, skipped } = collectSummaryHistory(files);
const chart = renderFailureRateChart(history.points);
const markdown = renderSummaryHistoryMarkdown(history, {
  sources: files.length,
  skipped: skipped.length,
  artifact: "return-to-coverage-report/history-graph.html",
}).join("\n");

mkdirSync(OUT_DIR, { recursive: true });
const svg = chart.match(/<svg[\s\S]*<\/svg>/)?.[0] ?? "";
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
</style>
<h1>return_to coverage — historical pass/fail &amp; failure rate</h1>
<p class="sub">${history.points.length} run(s) from ${files.length} uploaded summary file(s)${
    skipped.length ? `, ${skipped.length} skipped as unreadable/not a summary` : ""
  }.</p>
${chart}
<table>
  <thead><tr><th>Run</th><th>Generated</th><th>Pass</th><th>Fail</th><th>Assertions</th><th>Failure rate</th></tr></thead>
  <tbody>
    ${history.points
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
`,
);

const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
if (summaryFile) appendFileSync(summaryFile, `\n${markdown}\n`);

console.log(markdown);
console.log(
  `\nSummary files scanned: ${files.length} (${skipped.length} skipped) · points charted: ${history.points.length}`,
);
console.log(`Chart: ${join(OUT_DIR, "history-graph.html")}`);
