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
    ? data.suites.filter(isRecord).map((s) => ({
        id: str(s.id) ?? "unknown",
        fail: num(s.fail),
        ...(typeof s.pass === "number" ? { pass: num(s.pass) } : {}),
        ...(typeof s.assertions === "number" ? { assertions: num(s.assertions) } : {}),
      }))
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

/** Human-readable UTC timestamp for a run, `—` when the summary had none. */
export function formatRunDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Hover tooltip content for one charted point: exact date, run id, pass/fail
 * counts and the computed failure rate. Returned as lines so the SVG `<title>`
 * (native tooltip) and the richer HTML tooltip render the same facts.
 */
export function pointTooltipLines(point: HistoryPoint): string[] {
  const pass = point.totals.pass;
  const fail = point.totals.fail;
  const total = pass + fail;
  return [
    `Date: ${formatRunDate(point.generatedAt)}`,
    `Run: ${point.runId ?? "—"}${point.runNumber !== null ? ` (#${point.runNumber})` : ""}`,
    `Commit: ${shortLabel(point)}`,
    `Pass: ${pass}`,
    `Fail: ${fail}`,
    `Failure rate: ${failureRate(point).toFixed(2)}% (${fail}/${total || 0})`,
  ];
}

/** `pointTooltipLines` joined with newlines, for an SVG `<title>`. */
export const pointTooltip = (point: HistoryPoint): string => pointTooltipLines(point).join("\n");

/* ------------------------------------------------------------------ *
 * Run deep links
 *
 * Every charted point corresponds to one CI run, so each data point links out
 * to that run: the run-summary section (`#summary`), the job log, and the
 * artifact list. When the repo/run id isn't known (local runs, uploads without
 * `runId`), the link degrades to an in-page anchor so the point still jumps to
 * that run's row in the history table.
 * ------------------------------------------------------------------ */

export interface RunLinkOptions {
  /** e.g. `https://github.com` — defaults to `$GITHUB_SERVER_URL`. */
  server?: string | null;
  /** e.g. `owner/repo` — defaults to `$GITHUB_REPOSITORY`. */
  repo?: string | null;
}

export interface RunLinks {
  /** In-page anchor id/href for this run's row in the history table. */
  anchorId: string;
  anchor: string;
  /** GitHub run page anchored at the run summary, when resolvable. */
  summaryUrl: string | null;
  /** GitHub job log for the run, when resolvable. */
  logUrl: string | null;
  /** GitHub artifact list for the run, when resolvable. */
  artifactsUrl: string | null;
  /** Best available href for a click on the data point. */
  href: string;
}

const slug = (v: string): string => v.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);

/** Resolve every deep link for one charted run. */
export function runLinks(point: HistoryPoint, opts: RunLinkOptions = {}): RunLinks {
  const server = (opts.server ?? process.env.GITHUB_SERVER_URL ?? "https://github.com").replace(/\/+$/, "");
  const repo = opts.repo === undefined ? process.env.GITHUB_REPOSITORY ?? null : opts.repo;
  const anchorId = `run-${slug(point.runId ?? (point.generatedAt || shortLabel(point)))}`;
  const anchor = `#${anchorId}`;
  const base = repo && point.runId ? `${server}/${repo}/actions/runs/${point.runId}` : null;
  return {
    anchorId,
    anchor,
    summaryUrl: base ? `${base}#summary` : null,
    logUrl: base ? `${base}/job` : null,
    artifactsUrl: base ? `${base}#artifacts` : null,
    href: base ? `${base}#summary` : anchor,
  };
}

/** Tooltip lines plus the click hint, so the card explains where a click goes. */
export function pointTooltipLinesWithLink(point: HistoryPoint, opts: RunLinkOptions = {}): string[] {
  const links = runLinks(point, opts);
  return [
    ...pointTooltipLines(point),
    `Open: ${links.summaryUrl ? "run summary + CI log (click)" : "this run's row (click)"}`,
  ];
}




/* ------------------------------------------------------------------ *
 * Suite filters
 *
 * The pass/fail bars and the failure-rate line normally use each run's
 * `totals`. When a summary records per-suite counts, the same series can be
 * recomputed from a chosen subset of suites — so a noisy suite can be toggled
 * out to see whether the rest of the coverage is actually regressing.
 * ------------------------------------------------------------------ */

/** Every suite id seen across the history, sorted, for building filter UIs. */
export function listSuiteIds(points: readonly HistoryPoint[]): string[] {
  const ids = new Set<string>();
  for (const p of points) for (const s of p.suites) ids.add(s.id);
  return [...ids].sort();
}

/**
 * True when at least one run records per-suite `pass` counts. Without them a
 * filtered pass series would be a guess, so callers fall back to run totals and
 * say so instead of charting a made-up number.
 */
export function hasSuiteBreakdown(points: readonly HistoryPoint[]): boolean {
  return points.some((p) => p.suites.some((s) => typeof s.pass === "number"));
}

/** Per-suite totals across the whole history, for the filter legend. */
export function suiteTotals(
  points: readonly HistoryPoint[],
): { id: string; pass: number; fail: number; runs: number }[] {
  const acc = new Map<string, { id: string; pass: number; fail: number; runs: number }>();
  for (const p of points) {
    for (const s of p.suites) {
      const row = acc.get(s.id) ?? { id: s.id, pass: 0, fail: 0, runs: 0 };
      row.pass += s.pass ?? 0;
      row.fail += s.fail;
      row.runs += 1;
      acc.set(s.id, row);
    }
  }
  return [...acc.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Recompute each run's totals from the selected suites only. `null`/empty
 * selection (or a history without per-suite pass counts) leaves the points
 * untouched. Runs that contain none of the selected suites collapse to zero so
 * the timeline keeps its shape rather than silently dropping runs.
 */
export function applySuiteFilter(
  points: readonly HistoryPoint[],
  selected: readonly string[] | null,
): HistoryPoint[] {
  const source = [...points];
  if (!selected || selected.length === 0) return source;
  const wanted = new Set(selected);
  const all = listSuiteIds(points);
  if (all.length > 0 && all.every((id) => wanted.has(id))) return source;
  if (!hasSuiteBreakdown(points)) return source;
  return source.map((p) => {
    const kept = p.suites.filter((s) => wanted.has(s.id));
    const pass = kept.reduce((n, s) => n + (s.pass ?? 0), 0);
    const fail = kept.reduce((n, s) => n + s.fail, 0);
    const assertions = kept.reduce((n, s) => n + (s.assertions ?? 0), 0);
    return { ...p, totals: { pass, fail, assertions }, suites: kept };
  });
}

/* ------------------------------------------------------------------ *
 * CSV export
 *
 * The chart is a picture; these two CSVs are the numbers behind it, so the
 * time series can be opened in a spreadsheet or re-plotted elsewhere. Both are
 * generated from the same parsed `summary.json` points the chart uses, in the
 * same chronological order, so a row always matches a data point.
 *
 *  - `renderHistoryCsv`      — one row per run (wide: per-suite columns)
 *  - `renderSuiteHistoryCsv` — one row per run × suite (long/tidy format)
 * ------------------------------------------------------------------ */

/** RFC 4180 field: quote when the value contains a comma, quote or newline. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRow = (cells: readonly (string | number | null | undefined)[]): string =>
  cells.map(csvField).join(",");

/**
 * Wide CSV: one row per charted run, with run metadata, the totals driving the
 * pass/fail bars, the computed failure rate, counterexample stats, the run deep
 * link, and `<suite>_pass` / `<suite>_fail` columns for every suite in the
 * history (blank when that run didn't record the suite).
 */
export function renderHistoryCsv(
  points: readonly HistoryPoint[],
  opts: { links?: RunLinkOptions } = {},
): string {
  const suites = listSuiteIds(points);
  const header = [
    "run_index",
    "run_id",
    "run_number",
    "commit",
    "branch",
    "event",
    "generated_at",
    "pass",
    "fail",
    "assertions",
    "failure_rate_pct",
    "counterexamples_total",
    "counterexamples_blocked",
    "counterexamples_leaked",
    "run_url",
    ...suites.flatMap((id) => [`${id}_pass`, `${id}_fail`]),
  ];
  const rows = points.map((p, i) => {
    const byId = new Map(p.suites.map((s) => [s.id, s]));
    const link = runLinks(p, opts.links ?? {});
    return csvRow([
      i + 1,
      p.runId,
      p.runNumber,
      p.commit,
      p.branch,
      p.event,
      p.generatedAt,
      p.totals.pass,
      p.totals.fail,
      p.totals.assertions,
      failureRate(p).toFixed(2),
      p.counterexamples.total,
      p.counterexamples.blocked,
      p.counterexamples.leaked,
      link.summaryUrl ?? "",
      ...suites.flatMap((id) => {
        const s = byId.get(id);
        return s ? [s.pass ?? "", s.fail] : ["", ""];
      }),
    ]);
  });
  return [csvRow(header), ...rows].join("\n") + "\n";
}

/**
 * Long/tidy CSV: one row per run × suite, for pivoting or per-suite plotting
 * without parsing dynamic column names.
 */
export function renderSuiteHistoryCsv(points: readonly HistoryPoint[]): string {
  const header = csvRow([
    "run_index",
    "run_id",
    "commit",
    "generated_at",
    "suite",
    "pass",
    "fail",
    "assertions",
  ]);
  const rows = points.flatMap((p, i) =>
    p.suites.map((s) =>
      csvRow([i + 1, p.runId, p.commit, p.generatedAt, s.id, s.pass ?? "", s.fail, s.assertions ?? ""]),
    ),
  );
  return [header, ...rows].join("\n") + "\n";
}



/**
 * Normalize a comma/space separated suite filter (CLI flag or env var) into
 * known suite ids. Unknown ids are returned separately so the caller can warn.
 */
export function parseSuiteFilter(
  raw: string | null | undefined,
  known: readonly string[],
): { selected: string[] | null; unknown: string[] } {
  if (!raw) return { selected: null, unknown: [] };
  const wanted = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.length === 0 || wanted.includes("all")) return { selected: null, unknown: [] };
  const knownSet = new Set(known);
  return {
    selected: wanted.filter((id) => knownSet.has(id)),
    unknown: wanted.filter((id) => !knownSet.has(id)),
  };
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
 *
 * Each column is a link: clicking a data point opens that run's summary section
 * (and from there its CI log / artifacts), falling back to an in-page anchor for
 * runs without a resolvable GitHub run id.
 */
export function renderFailureRateChart(
  points: readonly HistoryPoint[],
  title = "Pass / fail and failure rate over time",
  linkOpts: RunLinkOptions = {},
): string {
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
  const yRate = (v: number) => PAD.top + plotH - (v / maxRate) * plotH;
  const links = points.map((p) => runLinks(p, linkOpts));

  const bars = points
    .map((p, i) => {
      const passH = (p.totals.pass / maxTests) * plotH;
      const failH = (p.totals.fail / maxTests) * plotH;
      const x = cx(i) - barW / 2;
      const passY = PAD.top + plotH - passH;
      const failY = passY - failH;
      return `<g><rect x="${x.toFixed(1)}" y="${passY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, passH).toFixed(1)}" fill="#16a34a" opacity="0.75" /><rect x="${x.toFixed(1)}" y="${failY.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, failH).toFixed(1)}" fill="#dc2626" /><title>${escapeXml(
        pointTooltip(p),
      )}</title></g>`;
    })
    .join("");

  const line = rates
    .map((v, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${yRate(v).toFixed(1)}`)
    .join(" ");
  const dots = rates
    .map(
      (v, i) =>
        `<circle cx="${cx(i).toFixed(1)}" cy="${yRate(v).toFixed(1)}" r="3" fill="#b45309"><title>${escapeXml(
          pointTooltip(points[i]!),
        )}</title></circle>`,
    )
    .join("");

  // Full-height transparent hit areas wrapped in a link: hovering anywhere in a
  // run's column shows that run's tooltip, and clicking opens that exact run.
  const hits = points
    .map((p, i) => {
      const l = links[i]!;
      const external = l.href.startsWith("http");
      return `<a href="${escapeXml(l.href)}"${
        external ? ' target="_blank" rel="noreferrer"' : ""
      } aria-label="${escapeXml(`Open run ${p.runId ?? shortLabel(p)}`)}"><rect class="pt-hit" x="${(
        cx(i) - slot / 2
      ).toFixed(1)}" y="${PAD.top}" width="${slot.toFixed(1)}" height="${plotH}" fill="transparent" data-tip="${escapeXml(
        pointTooltipLinesWithLink(p, linkOpts).join("|"),
      )}" data-href="${escapeXml(l.href)}"${
        l.logUrl ? ` data-log="${escapeXml(l.logUrl)}"` : ""
      }><title>${escapeXml(pointTooltip(p))}</title></rect></a>`;
    })
    .join("");

  const uid = `hc${chartUid()}`;
  return `<figure class="chart" id="${uid}" style="position:relative">
  <figcaption>${escapeXml(title)} — <span style="color:#16a34a">passing</span> / <span style="color:#dc2626">failing</span> tests with <span style="color:#b45309">failure rate</span> across ${n} run(s). Hover a column for the exact date, run id and counts; click it to open that run's summary.</figcaption>
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
    ${hits}
    <text x="${PAD.left}" y="${H - 8}" font-size="10" fill="#64748b">${escapeXml(shortLabel(points[0]!))}</text>
    <text x="${W - PAD.right}" y="${H - 8}" font-size="10" fill="#64748b" text-anchor="end">${escapeXml(shortLabel(points[n - 1]!))}</text>
  </svg>
  ${renderRunLinkList(points, linkOpts)}
  ${renderTooltipScript(uid)}
</figure>`;
}

/**
 * Printable/keyboard-accessible list of the same deep links the chart columns
 * carry — the PDF and screen readers get real anchors, not just hover targets.
 */
export function renderRunLinkList(
  points: readonly HistoryPoint[],
  linkOpts: RunLinkOptions = {},
): string {
  if (points.length === 0) return "";
  const items = points
    .slice(-12)
    .map((p) => {
      const l = runLinks(p, linkOpts);
      const label = `${shortLabel(p)}${p.runNumber !== null ? ` #${p.runNumber}` : ""}`;
      const parts = l.summaryUrl
        ? [
            `<a href="${escapeXml(l.summaryUrl)}" target="_blank" rel="noreferrer">${escapeXml(label)}</a>`,
            `<a href="${escapeXml(l.logUrl!)}" target="_blank" rel="noreferrer">log</a>`,
            `<a href="${escapeXml(l.artifactsUrl!)}" target="_blank" rel="noreferrer">artifacts</a>`,
          ]
        : [`<a href="${escapeXml(l.anchor)}">${escapeXml(label)}</a>`];
      return `<li>${parts.join(" · ")}</li>`;
    })
    .join("");
  return `<ul class="run-links">${items}</ul>`;
}


let uidSeq = 0;
const chartUid = (): number => ++uidSeq;

/**
 * Self-contained hover tooltip: reads `data-tip` (pipe separated lines) off any
 * `.pt-hit` element inside the host and shows a positioned HTML card. Native
 * `<title>` stays in the SVG as the no-JS/PDF fallback.
 */
export function renderTooltipScript(hostId: string): string {
  return `<div class="pt-tip" id="${hostId}-tip" hidden></div>
  <script>
  (function () {
    var host = document.getElementById(${JSON.stringify(hostId)});
    var tip = document.getElementById(${JSON.stringify(`${hostId}-tip`)});
    if (!host || !tip) return;
    function show(el, ev) {
      var lines = (el.getAttribute("data-tip") || "").split("|");
      tip.innerHTML = lines.map(function (l) {
        var i = l.indexOf(":");
        var k = i < 0 ? l : l.slice(0, i);
        return '<div><span class="pt-k">' + k + '</span> <span class="pt-v"></span></div>';

      }).join("");
      var vals = tip.querySelectorAll(".pt-v");
      lines.forEach(function (l, idx) {
        var i = l.indexOf(":");
        if (vals[idx]) vals[idx].textContent = i < 0 ? "" : l.slice(i + 1).trim();
      });
      var r = host.getBoundingClientRect();
      tip.hidden = false;
      var x = ev.clientX - r.left + 12;
      var y = ev.clientY - r.top + 12;
      tip.style.left = Math.min(x, Math.max(0, r.width - tip.offsetWidth - 8)) + "px";
      tip.style.top = Math.min(y, Math.max(0, r.height - tip.offsetHeight - 8)) + "px";
    }
    host.addEventListener("mousemove", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(".pt-hit") : null;
      if (el) show(el, ev); else tip.hidden = true;
    });
    host.addEventListener("mouseleave", function () { tip.hidden = true; });
  })();
  </script>`;
}

/** Styles for the hover tooltip card, to inline in host pages. */
export const CHART_TOOLTIP_CSS = `
  .pt-tip { position: absolute; z-index: 5; pointer-events: none; background: #0f172a; color: #f8fafc; border-radius: 6px; padding: 6px 8px; font-size: 11px; line-height: 1.45; box-shadow: 0 6px 18px rgba(15,23,42,.28); max-width: 280px; }
  .pt-tip[hidden] { display: none; }
  .pt-tip .pt-k { color: #94a3b8; }
  .pt-tip .pt-v { font-weight: 600; }
  .pt-hit { cursor: crosshair; }
  .pt-hit:hover { fill: rgba(148,163,184,.14); }
`;


/**
 * Interactive variant of the chart: the same pass/fail bars and failure-rate
 * line, plus a checkbox per suite that recomputes both series in the browser
 * from the embedded per-suite counts. Falls back to the static chart (with a
 * note) when the history has no per-suite pass counts to filter on.
 *
 * Self-contained: no external scripts, so it works from the CI artifact opened
 * off a filesystem. The PDF renderer just gets the initial server-rendered SVG.
 */
export function renderSuiteFilterChart(
  points: readonly HistoryPoint[],
  opts: {
    title?: string;
    selected?: readonly string[] | null;
    idPrefix?: string;
    links?: RunLinkOptions;
  } = {},
): string {
  const title = opts.title ?? "Pass / fail and failure rate over time";
  const linkOpts = opts.links ?? {};
  const ids = listSuiteIds(points);
  if (points.length === 0 || ids.length === 0 || !hasSuiteBreakdown(points)) {
    const note =
      points.length > 0 && ids.length > 0
        ? `<p class="sub">Suite filters need per-suite pass counts; these uploads only record failures, so the chart uses run totals for all ${ids.length} suite(s).</p>`
        : "";
    return renderFailureRateChart(points, title, linkOpts) + note;
  }
  const prefix = opts.idPrefix ?? "sf";
  const selected = new Set(opts.selected && opts.selected.length ? opts.selected : ids);
  const data = points.map((p) => {
    const l = runLinks(p, linkOpts);
    return {
      label: shortLabel(p),
      at: p.generatedAt,
      date: formatRunDate(p.generatedAt),
      runId: p.runId,
      runNumber: p.runNumber,
      href: l.href,
      log: l.logUrl,
      external: l.href.startsWith("http"),
      suites: p.suites.map((s) => ({ id: s.id, pass: s.pass ?? 0, fail: s.fail })),
    };
  });

  const initial = applySuiteFilter(points, [...selected]);
  const totals = suiteTotals(points);

  const checkboxes = ids
    .map((id) => {
      const t = totals.find((x) => x.id === id);
      return `<label class="suite-toggle"><input type="checkbox" data-suite="${escapeXml(id)}"${
        selected.has(id) ? " checked" : ""
      } /> <code>${escapeXml(id)}</code> <span class="sub">${t ? `${t.pass} pass · ${t.fail} fail` : ""}</span></label>`;
    })
    .join("\n      ");

  return `<figure class="chart suite-filter-chart" id="${prefix}-root" style="position:relative">
  <figcaption>${escapeXml(title)} — toggle suites to recompute the <span style="color:#16a34a">passing</span>/<span style="color:#dc2626">failing</span> bars and the <span style="color:#b45309">failure rate</span>. Hover a column for the exact date, run id, counts and failure rate; click it to open that run's summary and CI log.</figcaption>
  <div class="suite-toggles">
      ${checkboxes}
      <button type="button" data-suite-all="1">All</button>
      <button type="button" data-suite-none="1">None</button>
  </div>
  <div id="${prefix}-chart">${renderFailureRateChart(initial, title, linkOpts)}</div>
  <p class="sub" id="${prefix}-status">Showing ${selected.size} of ${ids.length} suite(s).</p>
  ${renderRunLinkList(points, linkOpts)}

  <script type="application/json" id="${prefix}-data">${JSON.stringify(data).replace(
    /</g,
    "\\u003c",
  )}</script>
  <script>
  (function () {
    var root = document.getElementById(${JSON.stringify(`${prefix}-root`)});
    if (!root) return;
    var runs = JSON.parse(document.getElementById(${JSON.stringify(`${prefix}-data`)}).textContent);
    var host = document.getElementById(${JSON.stringify(`${prefix}-chart`)});
    var status = document.getElementById(${JSON.stringify(`${prefix}-status`)});
    var boxes = Array.prototype.slice.call(root.querySelectorAll("input[data-suite]"));
    var W = 720, H = 220, PT = 18, PR = 44, PB = 30, PL = 46;
    var plotW = W - PL - PR, plotH = H - PT - PB;
    function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"; }); }
    function tipLines(p) {
      var total = p.pass + p.fail;
      return [
        "Date: " + (p.date || "—"),
        "Run: " + (p.runId || "—") + (p.runNumber != null ? " (#" + p.runNumber + ")" : ""),
        "Commit: " + p.label,
        "Pass: " + p.pass,
        "Fail: " + p.fail,
        "Failure rate: " + p.rate.toFixed(2) + "% (" + p.fail + "/" + total + ")",
        "Open: " + (p.external ? "run summary + CI log (click)" : "this run's row (click)")
      ];
    }
    function series(sel) {
      return runs.map(function (r) {
        var pass = 0, fail = 0;
        r.suites.forEach(function (s) { if (sel[s.id]) { pass += s.pass; fail += s.fail; } });
        var total = pass + fail;
        return { label: r.label, date: r.date, runId: r.runId, runNumber: r.runNumber, href: r.href, log: r.log, external: r.external, pass: pass, fail: fail, rate: total === 0 ? 0 : (fail / total) * 100 };
      });
    }

    function draw(pts) {
      if (!pts.length) { host.innerHTML = '<p class="sub">No suites selected.</p>'; return; }
      var n = pts.length;
      var maxTests = Math.max.apply(null, [1].concat(pts.map(function (p) { return p.pass + p.fail; })));
      var maxRate = Math.max.apply(null, [1].concat(pts.map(function (p) { return p.rate; })));
      var slot = plotW / n, barW = Math.max(3, Math.min(26, slot * 0.6));
      var cx = function (i) { return PL + slot * (i + 0.5); };
      var yRate = function (v) { return PT + plotH - (v / maxRate) * plotH; };
      var bars = pts.map(function (p, i) {
        var passH = (p.pass / maxTests) * plotH, failH = (p.fail / maxTests) * plotH;
        var x = cx(i) - barW / 2, passY = PT + plotH - passH, failY = passY - failH;
        return '<g><rect x="' + x.toFixed(1) + '" y="' + passY.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, passH).toFixed(1) + '" fill="#16a34a" opacity="0.75"/><rect x="' + x.toFixed(1) + '" y="' + failY.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, failH).toFixed(1) + '" fill="#dc2626"/><title>' + esc(tipLines(p).join("\\n")) + '</title></g>';
      }).join("");
      var line = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + cx(i).toFixed(1) + "," + yRate(p.rate).toFixed(1); }).join(" ");
      var dots = pts.map(function (p, i) { return '<circle cx="' + cx(i).toFixed(1) + '" cy="' + yRate(p.rate).toFixed(1) + '" r="3" fill="#b45309"><title>' + esc(tipLines(p).join("\\n")) + '</title></circle>'; }).join("");
      var hits = pts.map(function (p, i) { return '<a href="' + esc(p.href || "#") + '"' + (p.external ? ' target="_blank" rel="noreferrer"' : "") + ' aria-label="' + esc("Open run " + (p.runId || p.label)) + '"><rect class="pt-hit" x="' + (cx(i) - slot / 2).toFixed(1) + '" y="' + PT + '" width="' + slot.toFixed(1) + '" height="' + plotH + '" fill="transparent" data-tip="' + esc(tipLines(p).join("|")) + '" data-href="' + esc(p.href || "") + '"' + (p.log ? ' data-log="' + esc(p.log) + '"' : "") + '><title>' + esc(tipLines(p).join("\\n")) + '</title></rect></a>'; }).join("");
      host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img">' +
        '<line x1="' + PL + '" y1="' + (PT + plotH) + '" x2="' + (W - PR) + '" y2="' + (PT + plotH) + '" stroke="#cbd5e1"/>' +
        '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT + plotH) + '" stroke="#cbd5e1"/>' +
        '<text x="4" y="' + (PT + 10) + '" font-size="10" fill="#64748b">' + maxTests + '</text>' +
        '<text x="4" y="' + (PT + plotH) + '" font-size="10" fill="#64748b">0</text>' +
        '<text x="' + (W - PR + 6) + '" y="' + (PT + 10) + '" font-size="10" fill="#b45309">' + maxRate.toFixed(1) + '%</text>' +
        '<text x="' + (W - PR + 6) + '" y="' + (PT + plotH) + '" font-size="10" fill="#b45309">0%</text>' +
        bars + '<path d="' + line + '" fill="none" stroke="#b45309" stroke-width="2" stroke-dasharray="4 3"/>' + dots + hits +
        '<text x="' + PL + '" y="' + (H - 8) + '" font-size="10" fill="#64748b">' + esc(pts[0].label) + '</text>' +
        '<text x="' + (W - PR) + '" y="' + (H - 8) + '" font-size="10" fill="#64748b" text-anchor="end">' + esc(pts[n - 1].label) + '</text>' +
        '</svg>';
    }
    function update() {
      var sel = {}, count = 0;
      boxes.forEach(function (b) { if (b.checked) { sel[b.getAttribute("data-suite")] = true; count++; } });
      draw(count === 0 ? [] : series(sel));
      status.textContent = count === 0
        ? "No suites selected — pick at least one."
        : "Showing " + count + " of " + boxes.length + " suite(s).";
    }
    boxes.forEach(function (b) { b.addEventListener("change", update); });
    var all = root.querySelector("[data-suite-all]"), none = root.querySelector("[data-suite-none]");
    if (all) all.addEventListener("click", function () { boxes.forEach(function (b) { b.checked = true; }); update(); });
    if (none) none.addEventListener("click", function () { boxes.forEach(function (b) { b.checked = false; }); update(); });
    update();
  })();
  </script>
  ${renderTooltipScript(`${prefix}-root`)}
</figure>`;
}

/** Styles for the suite filter controls, to inline in host pages. */
export const SUITE_FILTER_CSS = `
  .suite-toggles { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 10px; font-size: 12px; }
  .suite-toggle { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #e2e8f0; border-radius: 999px; padding: 3px 9px; cursor: pointer; }
  .suite-toggles button { font: inherit; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
  .run-links { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; padding: 0; margin: 6px 0 0; font-size: 11px; color: #64748b; }
  .run-links a { color: #1d4ed8; text-decoration: none; }
  .run-links a:hover { text-decoration: underline; }
${CHART_TOOLTIP_CSS}`;




/**
 * Markdown for the run-summary page (`$GITHUB_STEP_SUMMARY`): sparklines plus a
 * compact per-run table. GitHub strips inline SVG from step summaries, so the
 * chart itself ships in the HTML/PDF artifact and this is the textual view.
 *
 * Step summaries can't be interactive, so the suite filter shows up two ways:
 * the active `selected` filter is stated up front (series already recomputed by
 * the caller via `applySuiteFilter`), and a per-suite table lists the
 * contribution of every suite so it's clear what toggling would change.
 */
export function renderSummaryHistoryMarkdown(
  history: History,
  opts: {
    sources?: number;
    skipped?: number;
    artifact?: string | null;
    /** Suite ids the series were filtered to; null/empty means all suites. */
    selected?: readonly string[] | null;
    /** Suite ids available before filtering (defaults to those in `history`). */
    allSuites?: readonly string[];
    /** Per-suite totals to tabulate (defaults to those in `history`). */
    breakdown?: readonly { id: string; pass: number; fail: number; runs: number }[];
    /** Server/repo used to build per-run deep links (defaults to env). */
    links?: RunLinkOptions;
    /** CSV artifact path to advertise; `false` hides the CSV line entirely. */
    csv?: string | false;

  } = {},

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
  const allSuites = opts.allSuites ?? listSuiteIds(pts);
  const selected = opts.selected && opts.selected.length ? [...opts.selected] : null;
  const filtered = selected !== null && selected.length < allSuites.length;
  const breakdown = opts.breakdown ?? suiteTotals(pts);
  return [
    `#### Uploaded summary history (${pts.length} run(s)${
      opts.skipped ? `, ${opts.skipped} file(s) skipped` : ""
    })`,
    "",
    ...(filtered
      ? [
          `> Suite filter active: **${selected!.map((id) => `\`${id}\``).join(", ")}** of ${
            allSuites.length
          } suite(s) — pass/fail and failure rate below cover only those suites.`,
          "",
        ]
      : allSuites.length
        ? [`_All ${allSuites.length} suite(s) included._`, ""]
        : []),
    "| Series | Trend | Latest |",
    "| --- | --- | ---: |",
    `| Passing tests | \`${sparkline(pts.map((p) => p.totals.pass))}\` | ${latest.totals.pass} |`,
    `| Failing tests | \`${sparkline(pts.map((p) => p.totals.fail))}\` | ${latest.totals.fail} |`,
    `| Failure rate | \`${sparkline(rates)}\` | ${rates.at(-1)!.toFixed(2)}% |`,
    "",
    "| Run | Date | Pass | Fail | Failure rate | Links |",
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...window.map((p) => {
      const l = runLinks(p, opts.links ?? {});
      // The anchor span makes the chart's in-page deep link land on this row.
      const runCell = l.summaryUrl
        ? `[\`${shortLabel(p)}\`](${l.summaryUrl})`
        : `<a id="${l.anchorId}"></a>\`${shortLabel(p)}\``;
      const linkCell = l.summaryUrl
        ? `[summary](${l.summaryUrl}) · [log](${l.logUrl}) · [artifacts](${l.artifactsUrl})`
        : "—";
      return `| ${runCell} | ${p.generatedAt || "—"} | ${p.totals.pass} | ${p.totals.fail} | ${failureRate(
        p,
      ).toFixed(2)}%${p.totals.fail > 0 ? " 🔴" : ""} | ${linkCell} |`;
    }),

    ...(breakdown.length
      ? [
          "",
          "<details><summary>Per-suite contribution (toggle these in the HTML chart)</summary>",
          "",
          "| Suite | In filter | Runs | Pass | Fail |",
          "| --- | :-: | ---: | ---: | ---: |",
          ...breakdown.map(
            (s) =>
              `| \`${s.id}\` | ${selected === null || selected.includes(s.id) ? "✅" : "—"} | ${
                s.runs
              } | ${s.pass} | ${s.fail} |`,
          ),
          "",
          "</details>",
        ]
      : []),
    "",
    opts.artifact
      ? `<sub>Chart (SVG, with interactive suite filters) is in \`${opts.artifact}\` on this run.</sub>`
      : "<sub>Chart (SVG, with interactive suite filters) ships with the coverage report artifact.</sub>",
    ...(opts.csv === false
      ? []
      : [
          `<sub>Time series CSV: \`${
            opts.csv ?? "return-to-coverage-report/history-graph.csv"
          }\` (one row per run) and \`history-suites.csv\` (one row per run × suite).</sub>`,
        ]),
  ];
}


