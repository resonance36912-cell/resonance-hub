/**
 * Concise coverage-trend PR comment.
 *
 * The detailed sticky comment (`pr-comment.md`) carries the full per-suite
 * tables. This builds a short digest — status, deltas, new failures, one
 * sparkline — that the workflow posts as its own sticky comment whenever the
 * return-to-coverage workflow finishes, so reviewers can read the trend
 * without expanding the long report.
 */

export const TREND_COMMENT_MARKER = "<!-- return-to-coverage-trend -->";

export type TrendCommentStatus = "pass" | "flaky" | "fail";

export interface TrendCommentInput {
  status: TrendCommentStatus;
  totals: { pass: number; fail: number; assertions: number };
  /** Null when no baseline was available (first run / missing artifact). */
  baselineCommit: string | null;
  delta: { pass: number; fail: number; assertions: number } | null;
  newFailures: readonly { title: string; fail: number }[];
  /** Suites present in the baseline but absent now. */
  removedSuites?: readonly string[];
  counterexamples?: { blocked: number; leaked: number; total: number } | null;
  /** ASCII sparkline of passing tests across recorded runs. */
  passSparkline?: string | null;
  runs?: number;
  commit?: string | null;
  runUrl?: string | null;
  /** Links to the exact stored counterexample inputs for NEW failures. */
  failureLinks?: readonly { label: string; url: string }[];
}

const signed = (n: number) => (n > 0 ? `+${n}` : n === 0 ? "±0" : `${n}`);

const STATUS_LINE: Record<TrendCommentStatus, string> = {
  pass: "✅ all passing",
  flaky: "⚠️ passing (flaky re-run)",
  fail: "❌ failing",
};

/** Short markdown body, prefixed with the sticky marker. */
export function buildTrendComment(input: TrendCommentInput): string {
  const {
    status,
    totals,
    baselineCommit,
    delta,
    newFailures,
    removedSuites = [],
    counterexamples,
    passSparkline,
    runs,
    commit,
    runUrl,
    failureLinks = [],
  } = input;

  const lines: string[] = [
    TREND_COMMENT_MARKER,
    `### return_to coverage trend — ${STATUS_LINE[status]}`,
    "",
    `**${totals.pass} passing** · **${totals.fail} failing** · ${totals.assertions.toLocaleString(
      "en-US",
    )} assertions`,
  ];

  if (delta && baselineCommit) {
    lines.push(
      "",
      `Δ vs \`${baselineCommit.slice(0, 12)}\`: pass ${signed(delta.pass)} · fail ${signed(
        delta.fail,
      )} · assertions ${signed(delta.assertions)}`,
    );
  } else {
    lines.push("", "_No baseline to compare against — this run becomes the baseline._");
  }

  if (newFailures.length) {
    lines.push(
      "",
      `> 🔴 **New failures:** ${newFailures.map((f) => `${f.title} (${f.fail})`).join(", ")}`,
    );
    for (const link of failureLinks.slice(0, 5)) {
      lines.push(`> - [${link.label}](${link.url})`);
    }
    if (failureLinks.length > 5) {
      lines.push(`> - …and ${failureLinks.length - 5} more in the report`);
    }
  } else if (delta) {
    lines.push("", "No new failures versus the baseline.");
  }

  if (removedSuites.length) {
    lines.push("", `> ⚠️ Suites missing vs baseline: ${removedSuites.join(", ")}`);
  }

  if (counterexamples) {
    lines.push(
      "",
      `Counterexamples: ${counterexamples.blocked}/${counterexamples.total} blocked${
        counterexamples.leaked ? ` · 🔴 ${counterexamples.leaked} leaked` : " · 0 leaked"
      }`,
    );
  }

  if (passSparkline) {
    lines.push("", `Passing tests over last ${runs ?? "n"} runs: \`${passSparkline}\``);
  }

  if (runUrl) {
    lines.push("", `[Full report & artifacts](${runUrl}) · [job log](${runUrl})`);
  }

  lines.push("", `<sub>Commit \`${(commit ?? "unknown").slice(0, 12)}\`</sub>`);
  return lines.join("\n");
}
