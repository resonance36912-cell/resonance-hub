/**
 * Clickable counterexample links for NEW FAILURE suites.
 *
 * When the trend section flags a suite as a NEW FAILURE, the useful debugging
 * artifact is not the suite summary — it is the exact input that broke. This
 * module:
 *
 *  1. extracts candidate counterexample inputs from a suite's runner output
 *     (fast-check `Counterexample: [...]`, vitest/bun `Received:`/`Expected:`
 *     lines, and any quoted URL-ish literal on a failure line),
 *  2. stores them verbatim in `counterexamples/<suiteId>.json` and renders a
 *     standalone `counterexamples/<suiteId>.html` page where every input has a
 *     stable `#cx-<n>` anchor, and
 *  3. builds the links CI prints in the log and the HTML report renders in the
 *     trend alert: report anchor, raw JSON store, and an admin deep link that
 *     opens `/admin/return-to-counterexamples` pre-filled with that input.
 *
 * Inputs are stored verbatim on purpose — they are synthetic hostile test
 * vectors from the repo's own corpus, never end-user data.
 */

export type StoredCounterexample = {
  /** `<suiteId>-<n>`, stable within a run. */
  id: string;
  suiteId: string;
  /** 1-based, matches the `#cx-<n>` anchor. */
  index: number;
  /** How the value was recognised in the runner output. */
  kind: "fast-check" | "received" | "expected" | "literal";
  /** The counterexample input, verbatim from the runner output. */
  input: string;
  /** Nearest failing test name above the match, when the runner printed one. */
  testName: string | null;
  /** 1-based line number in the (ANSI-stripped) runner output. */
  line: number;
};

export type CounterexampleLinks = {
  /** Anchor into the per-run counterexample page for this suite. */
  report: string;
  /** Raw stored JSON entry (same anchor-less file, `#` fragment ignored). */
  store: string;
  /** Admin tool, pre-filled with the exact input. */
  admin: string;
};

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(v: string): string {
  return v.replace(ANSI, "");
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TEST_NAME = /^\s*(?:[×✕✗x]|FAIL|fail|not ok\s+\d+\s+-?)\s*(.+?)\s*$/;
const FAST_CHECK = /Counterexample:\s*(\[[\s\S]*?\])\s*$/;
const RECEIVED = /^\s*(?:Received|received|Actual|actual):\s*(.+?)\s*$/;
const EXPECTED = /^\s*(?:Expected|expected):\s*(.+?)\s*$/;
/** Quoted literal that looks like a URL / origin / return_to payload. */
const LITERAL = /["'`]((?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|%2[fF]|\.{2}\/)[^"'`]{0,400})["'`]/g;

const MAX_PER_SUITE = 50;

/** Pull counterexample inputs out of one suite's runner output. */
export function extractCounterexamples(suiteId: string, output: string): StoredCounterexample[] {
  const lines = stripAnsi(output ?? "").split(/\r?\n/);
  const found: StoredCounterexample[] = [];
  const seen = new Set<string>();
  let testName: string | null = null;

  const push = (kind: StoredCounterexample["kind"], raw: string, line: number) => {
    const input = raw.trim();
    if (!input || found.length >= MAX_PER_SUITE) return;
    const key = `${kind}:${input}`;
    if (seen.has(key)) return;
    seen.add(key);
    const index = found.length + 1;
    found.push({ id: `${suiteId}-${index}`, suiteId, index, kind, input, testName, line });
  };

  lines.forEach((raw, i) => {
    const line = i + 1;
    const name = TEST_NAME.exec(raw);
    if (name?.[1] && !/^\d+\s*(pass|fail)/i.test(name[1])) testName = name[1];

    const fc = FAST_CHECK.exec(raw);
    if (fc?.[1]) push("fast-check", fc[1], line);

    const rec = RECEIVED.exec(raw);
    if (rec?.[1]) push("received", rec[1], line);

    const exp = EXPECTED.exec(raw);
    if (exp?.[1]) push("expected", exp[1], line);

    for (const m of raw.matchAll(LITERAL)) if (m[1]) push("literal", m[1], line);
  });

  return found;
}

export function counterexampleFileName(suiteId: string, ext: "html" | "json"): string {
  return `return-to-counterexamples-${suiteId}.${ext}`;
}

export type LinkBaseOptions = {
  /**
   * Absolute base for report links (e.g. a Pages/artifact host). When absent,
   * links stay relative so they work when the artifact is opened locally.
   */
  reportBaseUrl?: string | null;
  /** Hub origin serving `/admin/return-to-counterexamples`. */
  hubUrl?: string | null;
};

const DEFAULT_HUB = "https://reson8.life";

/** Report anchor + store + admin deep link for a single counterexample. */
export function counterexampleLinks(
  cx: StoredCounterexample,
  opts: LinkBaseOptions = {},
): CounterexampleLinks {
  const base = (opts.reportBaseUrl ?? "").replace(/\/+$/, "");
  const rel = `counterexamples/${counterexampleFileName(cx.suiteId, "html")}`;
  const relStore = `counterexamples/${counterexampleFileName(cx.suiteId, "json")}`;
  const hub = (opts.hubUrl ?? DEFAULT_HUB).replace(/\/+$/, "");
  return {
    report: `${base ? `${base}/` : ""}${rel}#cx-${cx.index}`,
    store: `${base ? `${base}/` : ""}${relStore}`,
    admin: `${hub}/admin/return-to-counterexamples?input=${encodeURIComponent(cx.input)}&suite=${encodeURIComponent(cx.suiteId)}`,
  };
}

/** Machine-readable store: the exact inputs, plus their links. */
export function counterexampleStoreJson(
  suiteId: string,
  suiteTitle: string,
  items: StoredCounterexample[],
  meta: Record<string, string>,
  opts: LinkBaseOptions = {},
): string {
  return (
    JSON.stringify(
      {
        generatedAt: meta["Generated"] ?? null,
        commit: meta["Commit"] ?? null,
        suite: { id: suiteId, title: suiteTitle },
        count: items.length,
        counterexamples: items.map((cx) => ({ ...cx, links: counterexampleLinks(cx, opts) })),
      },
      null,
      2,
    ) + "\n"
  );
}

const KIND_LABEL: Record<StoredCounterexample["kind"], string> = {
  "fast-check": "fast-check counterexample",
  received: "received value",
  expected: "expected value",
  literal: "URL-ish literal on a failing line",
};

/** Standalone page: one anchored card per stored counterexample input. */
export function renderCounterexamplesHtml(
  suiteId: string,
  suiteTitle: string,
  items: StoredCounterexample[],
  meta: Record<string, string>,
  opts: LinkBaseOptions = {},
): string {
  const metaRows = Object.entries(meta)
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`)
    .join("");
  const cards = items.length
    ? items
        .map((cx) => {
          const links = counterexampleLinks(cx, opts);
          return `<section class="cx" id="cx-${cx.index}">
    <h2><a class="anchor" href="#cx-${cx.index}">#${cx.index}</a> ${esc(KIND_LABEL[cx.kind])}</h2>
    <p class="sub">${cx.testName ? `test: <code>${esc(cx.testName)}</code> · ` : ""}runner output line ${cx.line} · id <code>${esc(cx.id)}</code></p>
    <pre>${esc(cx.input)}</pre>
    <p class="links"><a href="${esc(links.admin)}">Open in admin counterexample tool</a> · <a href="${esc(links.store)}">stored JSON</a></p>
  </section>`;
        })
        .join("\n")
    : `<p class="sub">No counterexample inputs could be parsed from this suite's output — open the per-suite report and read the raw runner log.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>return_to counterexamples — ${esc(suiteTitle)}</title>
<style>
  :root { color-scheme: light; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 auto; padding: 32px 24px 64px; max-width: 900px; color: #16181d; background: #fff; }
  h1 { margin: 0 0 4px; font-size: 24px; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .sub, .blurb { color: #5b6472; font-size: 13px; }
  dl.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px 18px; margin: 18px 0 26px; }
  dl.meta dt { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #78808f; }
  dl.meta dd { margin: 0; font-size: 13px; }
  .cx { border: 1px solid #e3e6ec; border-left: 4px solid #c0392b; border-radius: 10px; padding: 14px 16px; margin: 0 0 14px; background: #fcfcfd; }
  .cx:target { border-color: #c0392b; background: #fff5f4; box-shadow: 0 0 0 3px rgba(192,57,43,.14); }
  a.anchor { color: #c0392b; text-decoration: none; }
  pre { background: #12151b; color: #eef1f6; padding: 12px 14px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; white-space: pre-wrap; word-break: break-all; }
  .links { font-size: 13px; margin: 8px 0 0; }
</style></head>
<body>
  <h1>Counterexample inputs — ${esc(suiteTitle)}</h1>
  <p class="sub">The Resonance Hub · exact stored inputs for the <strong>NEW FAILURE</strong> in suite <code>${esc(suiteId)}</code> · ${items.length} input${items.length === 1 ? "" : "s"}</p>
  <dl class="meta">${metaRows}</dl>
  ${cards}
</body></html>`;
}

/** `::error::`-friendly one-liners for the CI log (annotations are clickable). */
export function counterexampleLogLines(
  suiteTitle: string,
  items: StoredCounterexample[],
  opts: LinkBaseOptions = {},
): string[] {
  return items.map((cx) => {
    const links = counterexampleLinks(cx, opts);
    const short = cx.input.length > 160 ? `${cx.input.slice(0, 160)}…` : cx.input;
    return `::error::NEW FAILURE input #${cx.index} in "${suiteTitle}": ${short} — report: ${links.report} · admin: ${links.admin}`;
  });
}

/** Markdown bullet list of counterexample links (PR comment / job summary). */
export function counterexampleMarkdown(
  suiteTitle: string,
  items: StoredCounterexample[],
  opts: LinkBaseOptions = {},
): string[] {
  if (!items.length) return [];
  return [
    `- **${suiteTitle}** — ${items.length} stored input${items.length === 1 ? "" : "s"}:`,
    ...items.slice(0, 10).map((cx) => {
      const links = counterexampleLinks(cx, opts);
      const short = cx.input.length > 90 ? `${cx.input.slice(0, 90)}…` : cx.input;
      return `  - [\`${short.replace(/`/g, "'")}\`](${links.admin}) · [report anchor](${links.report})`;
    }),
    ...(items.length > 10 ? [`  - …and ${items.length - 10} more in the stored JSON.`] : []),
  ];
}

/** HTML `<ul>` of counterexample links, injected into the trend alert. */
export function renderCounterexampleLinksHtml(
  groups: { suiteId: string; suiteTitle: string; items: StoredCounterexample[] }[],
  opts: LinkBaseOptions = {},
): string {
  const withItems = groups.filter((g) => g.items.length);
  if (!withItems.length) return "";
  return `<div class="cx-links">
    <p><strong>Stored counterexample inputs for new failures</strong> — click to open the exact input:</p>
    <ul>
    ${withItems
      .map(
        (g) => `<li>${esc(g.suiteTitle)}:
      <ul>${g.items
        .slice(0, 10)
        .map((cx) => {
          const links = counterexampleLinks(cx, opts);
          const short = cx.input.length > 120 ? `${cx.input.slice(0, 120)}…` : cx.input;
          return `<li><a href="${esc(links.report)}"><code>${esc(short)}</code></a> — <a href="${esc(links.admin)}">admin tool</a> · <a href="${esc(links.store)}">stored JSON</a></li>`;
        })
        .join("")}${
        g.items.length > 10 ? `<li>…and ${g.items.length - 10} more in the stored JSON.</li>` : ""
      }</ul>
    </li>`,
      )
      .join("\n")}
    </ul>
  </div>`;
}
