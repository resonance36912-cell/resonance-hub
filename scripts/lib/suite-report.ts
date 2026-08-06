/**
 * Per-suite report rendering for the `return_to` coverage job.
 *
 * The combined report (return-to-coverage-report.html) is great for a
 * pass/fail overview but slow to debug: a single failing suite's output is
 * buried in a long document. This module renders ONE standalone HTML page per
 * suite so CI can publish `return-to-suite-<id>.html/.pdf` as its own artifact.
 *
 * Kept dependency-free (plain strings in, HTML out) so it is unit-testable and
 * can be reused by any suite runner.
 */

export type SuiteReportInput = {
  id: string;
  title: string;
  file: string;
  blurb: string;
  runnerLabel: string;
  runnerReason: string;
  assertionSource: "expect-calls" | "tests" | "none";
  pass: number;
  fail: number;
  assertions: number;
  durationMs: number;
  output: string;
  /** stable-pass | flaky | reproduced-failure */
  verdict: string;
  verdictLabel: string;
  attempts: number;
  firstAttempt: { pass: number; fail: number; output: string } | null;
  /** Same-suite numbers from the last successful run, when available. */
  baseline: { pass: number; fail: number; assertions: number } | null;
};

export type SuiteReportMeta = Record<string, string>;

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `+3` / `-2` / `0`, so deltas read the same everywhere. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function suiteReportFileName(id: string, ext: "html" | "pdf" | "json"): string {
  return `return-to-suite-${id}.${ext}`;
}

/** Machine-readable per-suite summary written next to the HTML. */
export function suiteSummaryJson(s: SuiteReportInput, meta: SuiteReportMeta): string {
  return (
    JSON.stringify(
      {
        generatedAt: meta["Generated"] ?? null,
        commit: meta["Commit"] ?? null,
        suite: {
          id: s.id,
          title: s.title,
          file: s.file,
          runner: s.runnerLabel,
          pass: s.pass,
          fail: s.fail,
          assertions: s.assertions,
          durationMs: s.durationMs,
          attempts: s.attempts,
          verdict: s.verdict,
          status: s.verdict === "stable-pass" ? "pass" : s.verdict === "flaky" ? "flaky" : "fail",
          firstAttemptFail: s.firstAttempt?.fail ?? null,
        },
        baseline: s.baseline,
      },
      null,
      2,
    ) + "\n"
  );
}

const CSS = `
  @page { size: A4; margin: 14mm; }
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 24px; color: #10121a; background: #fff; }
  h1 { font-size: 23px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 15px; margin: 26px 0 6px; letter-spacing: -0.01em; }
  .sub { color: #5b6070; margin: 0 0 20px; font-size: 13px; }
  .banner { border-radius: 14px; padding: 15px 19px; margin-bottom: 16px; color: #fff; }
  .banner.ok { background: linear-gradient(90deg,#0f766e,#10b981); }
  .banner.warn { background: linear-gradient(90deg,#92400e,#f59e0b); }
  .banner.bad { background: linear-gradient(90deg,#7f1d1d,#ef4444); }
  .banner strong { font-size: 19px; display: block; }
  dl { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px 24px; margin: 0 0 8px; }
  dl div { display: flex; gap: 8px; font-size: 12px; border-bottom: 1px solid #eceef4; padding-bottom: 6px; }
  dt { color: #5b6070; min-width: 130px; }
  dd { margin: 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eceef4; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #5b6070; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .blurb { color: #5b6070; font-size: 11.5px; margin: 3px 0; max-width: 60ch; }
  code { font-size: 11px; color: #3b3f52; }
  .pill { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
  .pill.ok { background: #d1fae5; color: #065f46; }
  .pill.bad { background: #fee2e2; color: #991b1b; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.muted { background: #eef0f6; color: #4b5163; }
  td.bad { color: #991b1b; font-weight: 700; }
  pre { background: #f6f7fb; border: 1px solid #e5e8f0; border-radius: 10px; padding: 12px;
        font-size: 10.5px; white-space: pre-wrap; word-break: break-word; }
  footer { margin-top: 18px; font-size: 11px; color: #7a8092; }
`;

/** Standalone HTML page for a single suite. */
export function renderSuiteHtml(s: SuiteReportInput, meta: SuiteReportMeta): string {
  const tone = s.verdict === "stable-pass" ? "ok" : s.verdict === "flaky" ? "warn" : "bad";
  const headline =
    s.verdict === "stable-pass"
      ? "Suite passing"
      : s.verdict === "flaky"
        ? "Flaky — failed once, passed on retry"
        : `${s.fail} failing test${s.fail === 1 ? "" : "s"} (reproduced on retry)`;

  const metaRows = Object.entries({ Suite: s.title, File: s.file, ...meta })
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`)
    .join("");

  const baselineRow = s.baseline
    ? `<tr>
        <td>Last successful run</td>
        <td class="num">${s.baseline.pass}</td>
        <td class="num ${s.baseline.fail > 0 ? "bad" : ""}">${s.baseline.fail}</td>
        <td class="num">${s.baseline.assertions.toLocaleString("en-US")}</td>
      </tr>
      <tr>
        <td><strong>Delta</strong></td>
        <td class="num">${signed(s.pass - s.baseline.pass)}</td>
        <td class="num ${s.fail - s.baseline.fail > 0 ? "bad" : ""}">${signed(s.fail - s.baseline.fail)}</td>
        <td class="num">${signed(s.assertions - s.baseline.assertions)}</td>
      </tr>`
    : `<tr><td colspan="4" class="blurb">No baseline for this suite — first recorded run, or the previous artifact expired.</td></tr>`;

  const outputSection =
    s.verdict === "stable-pass"
      ? `<p class="sub">No failures. Runner output is included below for reference.</p>`
      : `<p class="sub">Raw runner output for every attempt, including any fast-check counterexample.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>return_to suite — ${esc(s.title)}</title>
<style>${CSS}</style></head>
<body>
  <h1>${esc(s.title)}</h1>
  <p class="sub">The Resonance Hub · per-suite <code>return_to</code> redirect-safety report · suite id <code>${esc(s.id)}</code></p>

  <div class="banner ${tone}">
    <strong>${esc(headline)}</strong>
    ${s.pass} passed · ${s.fail} failed · ${s.assertions.toLocaleString("en-US")} assertions · ${(s.durationMs / 1000).toFixed(2)}s · ${s.attempts} attempt${s.attempts === 1 ? "" : "s"}
  </div>

  <p class="blurb">${esc(s.blurb)}</p>
  <dl>${metaRows}</dl>
  <p class="blurb">Runner: <span class="pill muted">${esc(s.runnerLabel)}</span> ${esc(s.runnerReason)}${
    s.assertionSource === "expect-calls"
      ? ""
      : " · assertion count is a lower bound (runner reports tests only)"
  }</p>
  <p><span class="pill ${tone}">${esc(s.verdictLabel)}</span></p>

  <h2>Trend vs baseline</h2>
  <table>
    <thead><tr><th>Run</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Assertions</th></tr></thead>
    <tbody>
      <tr><td><strong>This run</strong></td><td class="num">${s.pass}</td><td class="num ${s.fail > 0 ? "bad" : ""}">${s.fail}</td><td class="num">${s.assertions.toLocaleString("en-US")}</td></tr>
      ${baselineRow}
    </tbody>
  </table>

  <h2>Runner output</h2>
  ${outputSection}
  <pre>${esc(s.output || "(no output captured)")}</pre>

  <footer>Contract: docs/return-to-allowlist.md · Generated by scripts/return-to-coverage-report.ts · Combined report: return-to-coverage-report.html</footer>
</body></html>`;
}
