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
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
    blurb:
      "percent-encoded hosts, userinfo smuggling, encoded path/query, homoglyph hosts.",
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
  pass: number;
  fail: number;
  assertions: number;
  durationMs: number;
  output: string;
};

const OUT_DIR = join(process.cwd(), "reports", "return-to-coverage");
const HTML_PATH = join(OUT_DIR, "return-to-coverage-report.html");
const JSON_PATH = join(OUT_DIR, "summary.json");

function num(re: RegExp, text: string): number {
  const m = text.match(re);
  return m ? Number(m[1]) : 0;
}

async function runSuite(s: (typeof SUITES)[number]): Promise<SuiteResult> {
  const started = Date.now();
  const proc = Bun.spawn(["bun", "test", s.file], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  // Bun's test reporter writes its summary to stderr.
  const output = `${out}${err}`.trim();
  return {
    ...s,
    pass: num(/(\d+)\s+pass/, output),
    fail: num(/(\d+)\s+fail/, output),
    assertions: num(/(\d+)\s+expect\(\) calls/, output),
    durationMs: Date.now() - started,
    output,
  };
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHtml(results: SuiteResult[], meta: Record<string, string>) {
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
      <td class="num">${r.pass}</td>
      <td class="num ${r.fail > 0 ? "bad" : ""}">${r.fail}</td>
      <td class="num">${r.assertions.toLocaleString("en-US")}</td>
      <td class="num">${(r.durationMs / 1000).toFixed(2)}s</td>
      <td><span class="pill ${r.fail === 0 ? "ok" : "bad"}">${r.fail === 0 ? "PASS" : "FAIL"}</span></td>
    </tr>`,
    )
    .join("\n");

  const failures = results
    .filter((r) => r.fail > 0)
    .map(
      (r) => `<section class="failure">
      <h3>${esc(r.title)} — ${r.fail} failing</h3>
      <p class="blurb">Raw runner output, including any fast-check counterexample:</p>
      <pre>${esc(r.output)}</pre>
    </section>`,
    )
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
  td.bad { color: #991b1b; font-weight: 700; }
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
    <thead><tr><th>Suite</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Assertions</th><th class="num">Time</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td><strong>Total</strong></td>
      <td class="num"><strong>${totals.pass}</strong></td>
      <td class="num ${totals.fail > 0 ? "bad" : ""}"><strong>${totals.fail}</strong></td>
      <td class="num"><strong>${totals.assertions.toLocaleString("en-US")}</strong></td>
      <td class="num"></td><td></td>
    </tr></tfoot>
  </table>

  ${green ? `<p class="sub" style="margin-top:18px">No counterexamples were produced — every fuzzed, normalized and percent-encoded input resolved to an allowlisted origin or a safe Hub fallback.</p>` : failures}

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
  Runner: `bun ${Bun.version}`,
  Suites: String(results.length),
};

mkdirSync(dirname(HTML_PATH), { recursive: true });
writeFileSync(HTML_PATH, renderHtml(results, meta));
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
lines.push(
  `${pad("SUITE", 38)}${pad("PASS", 7)}${pad("FAIL", 7)}${pad("ASSERTIONS", 12)}STATUS`,
);
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
    "Artifacts: `return-to-coverage-report.html` / `.pdf` on this run.",
  ].join("\n");
  appendFileSync(summaryFile, md + "\n");
}

if (totals.fail > 0 || totals.pass === 0) process.exit(1);
