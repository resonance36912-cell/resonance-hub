/**
 * Generates the `return_to` fuzz/encoding coverage report (HTML + JSON summary)
 * and prints a pass/fail table to the job log.
 *
 * Run:  bun run report:return-to-coverage
 *
 * Outputs (all under reports/return-to-coverage/):
 *   • return-to-coverage-report.html — human-readable report (also printed to PDF in CI)
 *   • summary.json                   — machine-readable pass/fail counts
 *
 * Exit code is non-zero when any suite fails, so CI goes red on a regression.
 * When a suite fails, its raw failure output (including fast-check
 * counterexamples) is embedded in the report and echoed to the log.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  RUNNER_LABEL,
  detectRunner,
  parseRunnerOutput,
  runnerCommand,
  type TestRunner,
} from "./lib/test-runner-detect";


const SUITES: { id: string; title: string; file: string; blurb: string }[] = [
  {
    id: "fuzz",
    title: "Property-based fuzzing",
    file: "scripts/lib/return-to-allowlist-fuzz.test.ts",
    blurb:
      "fast-check generators throw arbitrary strings, hosts and schemes at the allowlist; no input may resolve to an unallowlisted navigation.",
  },
  {
    id: "normalization",
    title: "Normalization edge cases",
    file: "scripts/lib/return-to-allowlist-normalization.test.ts",
    blurb:
      "trailing slashes, uppercase/mixed-case hosts, explicit default ports, trailing-dot hosts, suffix grafts.",
  },
  {
    id: "encoding",
    title: "Percent-encoding edge cases",
    file: "scripts/lib/return-to-allowlist-encoding.test.ts",
    blurb: "percent-encoded hosts, userinfo smuggling, encoded path/query, homoglyph hosts.",
  },
  {
    id: "audit",
    title: "Redirect audit records",
    file: "scripts/lib/return-to-audit.test.ts",
    blurb:
      "audit rows keep origin-only candidates and path-only targets — never full URLs, query strings or fragments.",
  },
  {
    id: "targets",
    title: "Checkout success target resolution",
    file: "scripts/lib/checkout-success-return-to-allowlist.test.ts",
    blurb:
      "allowlisted spoke origins drive the primary CTA / auto-redirect; anything else falls back to a safe Hub target.",
  },
];

type SuiteResult = {
  id: string;
  title: string;
  file: string;
  blurb: string;
  /** Framework detected from the suite's imports. */
  runner: TestRunner;
  /** Why that runner was chosen. */
  runnerReason: string;
  /** Whether `assertions` are real expect() calls or a test-count fallback. */
  assertionSource: "expect-calls" | "tests" | "none";
  pass: number;
  fail: number;
  assertions: number;
  durationMs: number;
  output: string;
};


const OUT_DIR = join(process.cwd(), "reports", "return-to-coverage");
const HTML_PATH = join(OUT_DIR, "return-to-coverage-report.html");
const JSON_PATH = join(OUT_DIR, "summary.json");

/**
 * Baseline = the `summary.json` produced by the last successful run of this
 * report (CI downloads it from that run's artifact into
 * reports/return-to-coverage/baseline/). When it is absent the trend section
 * simply reports "no baseline" instead of failing.
 */
const BASELINE_PATH =
  process.env["RETURN_TO_COVERAGE_BASELINE"] ?? join(OUT_DIR, "baseline", "summary.json");

type Totals = { pass: number; fail: number; assertions: number };
type BaselineSuite = { id: string; title?: string; pass: number; fail: number; assertions: number };
type Baseline = {
  generatedAt?: string;
  commit?: string;
  totals: Totals;
  suites: BaselineSuite[];
};

type TrendState =
  | "new-failure"
  | "still-failing"
  | "fixed"
  | "tests-removed"
  | "new-suite"
  | "stable";

type TrendRow = {
  id: string;
  title: string;
  pass: number;
  fail: number;
  assertions: number;
  basePass: number | null;
  baseFail: number | null;
  baseAssertions: number | null;
  state: TrendState;
};

type Trend = {
  baseline: Baseline | null;
  rows: TrendRow[];
  removed: BaselineSuite[];
  newFailures: TrendRow[];
  delta: Totals;
};

function loadBaseline(): Baseline | null {
  try {
    if (!existsSync(BASELINE_PATH)) return null;
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
    if (!parsed?.totals || !Array.isArray(parsed.suites)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function computeTrend(results: SuiteResult[], baseline: Baseline | null): Trend {
  const byId = new Map((baseline?.suites ?? []).map((s) => [s.id, s]));
  const rows: TrendRow[] = results.map((r) => {
    const base = byId.get(r.id);
    let state: TrendState;
    if (!base) state = r.fail > 0 ? "new-failure" : "new-suite";
    else if (r.fail > 0 && base.fail === 0) state = "new-failure";
    else if (r.fail > 0) state = "still-failing";
    else if (base.fail > 0) state = "fixed";
    else if (r.pass < base.pass) state = "tests-removed";
    else state = "stable";
    return {
      id: r.id,
      title: r.title,
      pass: r.pass,
      fail: r.fail,
      assertions: r.assertions,
      basePass: base ? base.pass : null,
      baseFail: base ? base.fail : null,
      baseAssertions: base ? base.assertions : null,
      state,
    };
  });
  const seen = new Set(results.map((r) => r.id));
  const removed = (baseline?.suites ?? []).filter((s) => !seen.has(s.id));
  const current = results.reduce<Totals>(
    (a, r) => ({
      pass: a.pass + r.pass,
      fail: a.fail + r.fail,
      assertions: a.assertions + r.assertions,
    }),
    { pass: 0, fail: 0, assertions: 0 },
  );
  const delta: Totals = baseline
    ? {
        pass: current.pass - baseline.totals.pass,
        fail: current.fail - baseline.totals.fail,
        assertions: current.assertions - baseline.totals.assertions,
      }
    : { pass: 0, fail: 0, assertions: 0 };
  return {
    baseline,
    rows,
    removed,
    newFailures: rows.filter((r) => r.state === "new-failure"),
    delta,
  };
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString("en-US")}` : n.toLocaleString("en-US"));

const TREND_LABEL: Record<TrendState, string> = {
  "new-failure": "NEW FAILURE",
  "still-failing": "still failing",
  fixed: "fixed",
  "tests-removed": "tests removed",
  "new-suite": "new suite",
  stable: "unchanged",
};

function renderTrendHtml(trend: Trend): string {
  if (!trend.baseline) {
    return `<section class="trend">
    <h2>Coverage trend</h2>
    <p class="sub">No baseline available — this is the first recorded run, or the last successful run's <code>summary.json</code> artifact has expired. The next run will compare against this one.</p>
  </section>`;
  }
  const rows = trend.rows
    .map((r) => {
      const cls =
        r.state === "new-failure"
          ? "bad"
          : r.state === "fixed"
            ? "ok"
            : r.state === "still-failing" || r.state === "tests-removed"
              ? "warn"
              : "";
      const dPass = r.basePass === null ? "—" : signed(r.pass - r.basePass);
      const dFail = r.baseFail === null ? "—" : signed(r.fail - r.baseFail);
      const dAsserts = r.baseAssertions === null ? "—" : signed(r.assertions - r.baseAssertions);
      return `<tr class="${cls === "bad" ? "row-bad" : ""}">
      <td>${esc(r.title)}</td>
      <td class="num">${r.basePass === null ? "—" : r.basePass} → ${r.pass}</td>
      <td class="num">${dPass}</td>
      <td class="num ${r.fail > 0 ? "bad" : ""}">${r.baseFail === null ? "—" : r.baseFail} → ${r.fail}</td>
      <td class="num">${dFail}</td>
      <td class="num">${dAsserts}</td>
      <td><span class="pill ${cls || "muted"}">${TREND_LABEL[r.state]}</span></td>
    </tr>`;
    })
    .join("\n");

  const removed = trend.removed.length
    ? `<p class="sub"><strong>Suites present in the baseline but missing now:</strong> ${trend.removed
        .map((s) => esc(s.title ?? s.id))
        .join(", ")} — redirect-safety coverage was deleted or renamed.</p>`
    : "";

  const alert = trend.newFailures.length
    ? `<div class="alert">New failures since the last successful run: ${trend.newFailures
        .map((r) => `<strong>${esc(r.title)}</strong> (${r.fail} failing)`)
        .join(", ")}</div>`
    : `<p class="sub">No new failures versus the last successful run.</p>`;

  return `<section class="trend">
    <h2>Coverage trend</h2>
    <p class="sub">Compared against the last successful run — commit <code>${esc(
      (trend.baseline.commit ?? "unknown").slice(0, 12),
    )}</code>, generated ${esc(trend.baseline.generatedAt ?? "unknown")}. Totals moved
      ${signed(trend.delta.pass)} passing, ${signed(trend.delta.fail)} failing,
      ${signed(trend.delta.assertions)} assertions.</p>
    ${alert}
    <table>
      <thead><tr><th>Suite</th><th class="num">Pass (was → now)</th><th class="num">Δ</th><th class="num">Fail (was → now)</th><th class="num">Δ</th><th class="num">Δ assertions</th><th>Trend</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${removed}
  </section>`;
}

/**
 * Execute one suite with the framework it is actually written against.
 *
 * The runner is detected from the file's imports (`bun:test` vs `vitest`), the
 * matching command is spawned, and both runners' summaries are normalized into
 * the same pass/fail/assertion shape so the report stays consistent.
 */
async function runSuite(s: (typeof SUITES)[number]): Promise<SuiteResult> {
  const started = Date.now();
  const { runner, reason } = detectRunner(join(process.cwd(), s.file));
  const cmd = runnerCommand(runner, s.file);
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  // Both reporters split output across stdout/stderr; parse the combination.
  const output = `$ ${cmd.join(" ")}\n\n${`${out}${err}`.trim()}`;
  const parsed = parseRunnerOutput(runner, output);
  // A crashed/unparseable run must never read as "0 failures".
  const fail = parsed.unparseable && exitCode !== 0 ? Math.max(parsed.fail, 1) : parsed.fail;
  return {
    ...s,
    runner,
    runnerReason: reason,
    assertionSource: parsed.assertionSource,
    pass: parsed.pass,
    fail,
    assertions: parsed.assertions,
    durationMs: Date.now() - started,
    output,
  };
}


function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(results: SuiteResult[], meta: Record<string, string>, trend: Trend) {
  const totals = results.reduce(
    (a, r) => ({
      pass: a.pass + r.pass,
      fail: a.fail + r.fail,
      assertions: a.assertions + r.assertions,
    }),
    { pass: 0, fail: 0, assertions: 0 },
  );
  const green = totals.fail === 0;

  const rows = results
    .map(
      (r) => `<tr>
      <td><strong>${esc(r.title)}</strong><div class="blurb">${esc(r.blurb)}</div><code>${esc(r.file)}</code></td>
      <td><span class="pill muted">${esc(RUNNER_LABEL[r.runner])}</span><div class="blurb">${esc(r.runnerReason)}</div></td>
      <td class="num">${r.pass}</td>
      <td class="num ${r.fail > 0 ? "bad" : ""}">${r.fail}</td>
      <td class="num">${r.assertions.toLocaleString("en-US")}${
        r.assertionSource === "expect-calls" ? "" : "<sup>*</sup>"
      }</td>
      <td class="num">${(r.durationMs / 1000).toFixed(2)}s</td>
      <td><span class="pill ${r.fail === 0 ? "ok" : "bad"}">${r.fail === 0 ? "PASS" : "FAIL"}</span></td>
    </tr>`,
    )
    .join("\n");

  const assertionNote = results.some((r) => r.assertionSource !== "expect-calls")
    ? `<p class="sub" style="margin-top:8px"><sup>*</sup> Suite ran under a runner that does not report assertion counts (vitest); its test count is used as a lower bound.</p>`
    : "";

  const failures = results
    .filter((r) => r.fail > 0)
    .map(
      (r) => `<section class="failure">
      <h3>${esc(r.title)} — ${r.fail} failing <span class="pill muted">${esc(RUNNER_LABEL[r.runner])}</span></h3>
      <p class="blurb">Raw runner output, including any fast-check counterexample:</p>
      <pre>${esc(r.output)}</pre>
    </section>`,
    )
    .join("\n");

    .join("\n");

  const metaRows = Object.entries(meta)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>return_to coverage report</title>
<style>
  @page { size: A4; margin: 14mm; }
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 24px; color: #10121a; background: #fff; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  .sub { color: #5b6070; margin: 0 0 24px; font-size: 13px; }
  .banner { border-radius: 14px; padding: 16px 20px; margin-bottom: 18px; color: #fff;
            background: ${green ? "linear-gradient(90deg,#0f766e,#10b981)" : "linear-gradient(90deg,#7f1d1d,#ef4444)"}; }
  .banner strong { font-size: 20px; display: block; }
  dl { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px 24px; margin: 0 0 18px; }
  dl div { display: flex; gap: 8px; font-size: 12px; border-bottom: 1px solid #eceef4; padding-bottom: 6px; }
  dt { color: #5b6070; min-width: 130px; }
  dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eceef4; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #5b6070; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .blurb { color: #5b6070; font-size: 11.5px; margin: 3px 0; max-width: 46ch; }
  code { font-size: 11px; color: #3b3f52; }
  .pill { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
  .pill.ok { background: #d1fae5; color: #065f46; }
  .pill.bad { background: #fee2e2; color: #991b1b; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.muted { background: #eef0f6; color: #4b5163; }
  td.bad { color: #991b1b; font-weight: 700; }
  .trend { margin-top: 26px; page-break-inside: avoid; }
  .trend h2 { font-size: 16px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .trend .sub { margin: 0 0 10px; }
  tr.row-bad td { background: #fff5f5; }
  .alert { background: #fee2e2; border: 1px solid #fecaca; color: #7f1d1d; border-radius: 10px;
           padding: 9px 12px; font-size: 12px; margin: 0 0 10px; }
  .failure { margin-top: 28px; page-break-inside: avoid; }
  pre { background: #f6f7fb; border: 1px solid #e5e8f0; border-radius: 10px; padding: 12px;
        font-size: 10.5px; white-space: pre-wrap; word-break: break-word; }
  footer { margin-top: 16px; font-size: 11px; color: #7a8092; }
</style></head>
<body>
  <h1>return_to allowlist — fuzz &amp; encoding coverage</h1>
  <p class="sub">The Resonance Hub · redirect-safety test coverage for post-checkout <code>return_to</code> handling</p>

  <div class="banner">
    <strong>${green ? "All suites passing" : `${totals.fail} failing test${totals.fail === 1 ? "" : "s"}`}</strong>
    ${totals.pass} passed · ${totals.fail} failed · ${totals.assertions.toLocaleString("en-US")} assertions across ${results.length} suites
  </div>

  <dl>${metaRows}</dl>

  <table>
    <thead><tr><th>Suite</th><th>Runner</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Assertions</th><th class="num">Time</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td><strong>Total</strong></td>
      <td></td>
      <td class="num"><strong>${totals.pass}</strong></td>
      <td class="num ${totals.fail > 0 ? "bad" : ""}"><strong>${totals.fail}</strong></td>
      <td class="num"><strong>${totals.assertions.toLocaleString("en-US")}</strong></td>
      <td class="num"></td><td></td>
    </tr></tfoot>
  </table>
  ${assertionNote}

  ${green ? `<p class="sub" style="margin-top:18px">No counterexamples were produced — every fuzzed, normalized and percent-encoded input resolved to an allowlisted origin or a safe Hub fallback.</p>` : failures}


  ${renderTrendHtml(trend)}

  <footer>Contract: docs/return-to-allowlist.md · Generated by scripts/return-to-coverage-report.ts</footer>
</body></html>`;
}

const results: SuiteResult[] = [];
for (const s of SUITES) results.push(await runSuite(s));

const totals = results.reduce(
  (a, r) => ({
    pass: a.pass + r.pass,
    fail: a.fail + r.fail,
    assertions: a.assertions + r.assertions,
  }),
  { pass: 0, fail: 0, assertions: 0 },
);

const meta: Record<string, string> = {
  Generated: new Date().toISOString(),
  Commit: process.env.GITHUB_SHA ?? "local",
  Ref: process.env.GITHUB_REF ?? "local",
  Workflow: process.env.GITHUB_WORKFLOW ?? "local run",
  Host: `bun ${Bun.version}`,
  Runners: Array.from(
    new Set(results.map((r) => `${RUNNER_LABEL[r.runner]} (${results.filter((x) => x.runner === r.runner).length})`)),
  ).join(" · "),
  Suites: String(results.length),
};

const trend = computeTrend(results, loadBaseline());
meta["Baseline"] = trend.baseline
  ? `${(trend.baseline.commit ?? "unknown").slice(0, 12)} · ${trend.baseline.generatedAt ?? "unknown"}`
  : "none (first recorded run)";

mkdirSync(dirname(HTML_PATH), { recursive: true });
writeFileSync(HTML_PATH, renderHtml(results, meta, trend));
writeFileSync(
  JSON_PATH,
  JSON.stringify(
    {
      generatedAt: meta.Generated,
      commit: meta.Commit,
      totals,
      suites: results.map(({ output, ...r }) => ({
        ...r,
        status: r.fail === 0 ? "pass" : "fail",
      })),
      trend: {
        baselineCommit: trend.baseline?.commit ?? null,
        baselineGeneratedAt: trend.baseline?.generatedAt ?? null,
        baselineTotals: trend.baseline?.totals ?? null,
        delta: trend.baseline ? trend.delta : null,
        newFailures: trend.newFailures.map((r) => ({ id: r.id, title: r.title, fail: r.fail })),
        removedSuites: trend.removed.map((s) => s.id),
        suites: trend.rows.map((r) => ({ id: r.id, state: r.state })),
      },
    },
    null,
    2,
  ) + "\n",
);

// ---- Job log summary -------------------------------------------------------
const lines: string[] = [];
lines.push("return_to fuzz/encoding coverage");
lines.push("");
const pad = (v: string, n: number) => v.padEnd(n);
lines.push(`${pad("SUITE", 38)}${pad("PASS", 7)}${pad("FAIL", 7)}${pad("ASSERTIONS", 12)}STATUS`);
for (const r of results) {
  lines.push(
    `${pad(r.title, 38)}${pad(String(r.pass), 7)}${pad(String(r.fail), 7)}${pad(
      r.assertions.toLocaleString("en-US"),
      12,
    )}${r.fail === 0 ? "PASS" : "FAIL"}`,
  );
}
lines.push(
  `${pad("TOTAL", 38)}${pad(String(totals.pass), 7)}${pad(String(totals.fail), 7)}${pad(
    totals.assertions.toLocaleString("en-US"),
    12,
  )}${totals.fail === 0 ? "PASS" : "FAIL"}`,
);
// ---- Coverage trend (vs last successful run) -------------------------------
lines.push("");
if (!trend.baseline) {
  lines.push(
    "TREND: no baseline (last successful run's summary.json unavailable) — this run becomes the baseline.",
  );
} else {
  lines.push(
    `TREND vs last successful run (${(trend.baseline.commit ?? "unknown").slice(0, 12)} @ ${
      trend.baseline.generatedAt ?? "unknown"
    })`,
  );
  lines.push("");
  lines.push(`${pad("SUITE", 38)}${pad("PASS", 14)}${pad("FAIL", 12)}${pad("Δ ASSERT", 11)}TREND`);
  for (const r of trend.rows) {
    lines.push(
      `${pad(r.title, 38)}${pad(`${r.basePass ?? "-"} -> ${r.pass}`, 14)}${pad(
        `${r.baseFail ?? "-"} -> ${r.fail}`,
        12,
      )}${pad(r.baseAssertions === null ? "-" : signed(r.assertions - r.baseAssertions), 11)}${
        r.state === "new-failure" ? "NEW FAILURE" : TREND_LABEL[r.state]
      }`,
    );
  }
  lines.push(
    `${pad("TOTAL", 38)}${pad(`${signed(trend.delta.pass)}`, 14)}${pad(
      `${signed(trend.delta.fail)}`,
      12,
    )}${pad(signed(trend.delta.assertions), 11)}${
      trend.newFailures.length
        ? `${trend.newFailures.length} SUITE(S) NEWLY FAILING`
        : "no new failures"
    }`,
  );
  if (trend.removed.length) {
    lines.push(`WARNING: suites missing vs baseline: ${trend.removed.map((s) => s.id).join(", ")}`);
  }
  for (const r of trend.newFailures) {
    lines.push(`::error::New return_to failure in "${r.title}" — ${r.fail} failing test(s).`);
  }
}

console.log(lines.join("\n"));
console.log(`\nHTML report: ${HTML_PATH}`);
console.log(`Summary JSON: ${JSON_PATH}`);

for (const r of results.filter((x) => x.fail > 0)) {
  console.log(`\n----- FAILURE OUTPUT: ${r.title} (${r.file}) -----`);
  console.log(r.output);
}

// GitHub Actions job summary (markdown table on the run page).
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  const trendMd = !trend.baseline
    ? ["#### Coverage trend", "", "_No baseline yet — this run becomes the baseline._"]
    : [
        `#### Coverage trend vs last successful run (\`${(trend.baseline.commit ?? "unknown").slice(0, 12)}\`)`,
        "",
        ...(trend.newFailures.length
          ? [
              `> ⚠️ **New failures:** ${trend.newFailures.map((r) => `${r.title} (${r.fail})`).join(", ")}`,
              "",
            ]
          : ["No new failures versus the last successful run.", ""]),
        "| Suite | Pass (was → now) | Fail (was → now) | Δ assertions | Trend |",
        "| --- | ---: | ---: | ---: | --- |",
        ...trend.rows.map(
          (r) =>
            `| ${r.title} | ${r.basePass ?? "—"} → ${r.pass} | ${r.baseFail ?? "—"} → ${r.fail} | ${
              r.baseAssertions === null ? "—" : signed(r.assertions - r.baseAssertions)
            } | ${r.state === "new-failure" ? "🔴 NEW FAILURE" : TREND_LABEL[r.state]} |`,
        ),
        `| **Total** | **${signed(trend.delta.pass)}** | **${signed(trend.delta.fail)}** | **${signed(trend.delta.assertions)}** | ${trend.newFailures.length ? "🔴 regression" : "✅ no new failures"} |`,
        ...(trend.removed.length
          ? ["", `> ⚠️ Suites missing vs baseline: ${trend.removed.map((s) => s.id).join(", ")}`]
          : []),
      ];
  const md = [
    `### return_to fuzz & encoding coverage — ${totals.fail === 0 ? "✅ all passing" : `❌ ${totals.fail} failing`}`,
    "",
    "| Suite | Pass | Fail | Assertions | Status |",
    "| --- | ---: | ---: | ---: | --- |",
    ...results.map(
      (r) =>
        `| ${r.title} | ${r.pass} | ${r.fail} | ${r.assertions.toLocaleString("en-US")} | ${r.fail === 0 ? "PASS" : "FAIL"} |`,
    ),
    `| **Total** | **${totals.pass}** | **${totals.fail}** | **${totals.assertions.toLocaleString("en-US")}** | ${totals.fail === 0 ? "PASS" : "FAIL"} |`,
    "",
    ...trendMd,
    "",
    "Artifacts: `return-to-coverage-report.html` / `.pdf` on this run.",
  ].join("\n");
  appendFileSync(summaryFile, md + "\n");
}

if (totals.fail > 0 || totals.pass === 0) process.exit(1);
