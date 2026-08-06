import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectSummaryHistory,
  failureRate,
  findSummaryFiles,
  parseSummaryPoint,
  renderFailureRateChart,
  renderSummaryHistoryMarkdown,
  applySuiteFilter,
  hasSuiteBreakdown,
  listSuiteIds,
  parseSuiteFilter,
  renderSuiteFilterChart,
  suiteTotals,
  pointTooltip,
  pointTooltipLines,
  formatRunDate,
  runLinks,
} from "./summary-history";

const summary = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    generatedAt: "2026-08-01T10:00:00.000Z",
    commit: "aaaaaaaaaaaa1111",
    totals: { pass: 100, fail: 0, assertions: 3000 },
    counterexamples: { total: 27, blocked: 27, leaked: 0 },
    suites: [{ id: "encoding", fail: 0 }],
    ...over,
  });

describe("parseSummaryPoint", () => {
  it("maps a coverage summary into a history point", () => {
    const p = parseSummaryPoint(summary())!;
    expect(p.totals).toEqual({ pass: 100, fail: 0, assertions: 3000 });
    expect(p.commit).toBe("aaaaaaaaaaaa1111");
    expect(p.counterexamples.total).toBe(27);
  });

  it("rejects non-summary JSON and malformed files", () => {
    expect(parseSummaryPoint("{}")).toBeNull();
    expect(parseSummaryPoint("not json")).toBeNull();
    expect(parseSummaryPoint(JSON.stringify({ totals: { pass: "x" } }))).toBeNull();
  });

  it("falls back to the source label when commit is missing", () => {
    const p = parseSummaryPoint(summary({ commit: undefined }), "runs/7/summary.json")!;
    expect(p.commit).toBe("runs/7/summary.json");
  });
});

describe("failureRate", () => {
  it("is fail / executed as a percentage", () => {
    expect(failureRate(parseSummaryPoint(summary({ totals: { pass: 90, fail: 10, assertions: 1 } }))!)).toBe(10);
  });

  it("is 0 when nothing ran", () => {
    expect(failureRate(parseSummaryPoint(summary({ totals: { pass: 0, fail: 0, assertions: 0 } }))!)).toBe(0);
  });
});

describe("collectSummaryHistory", () => {
  const dir = mkdtempSync(join(tmpdir(), "summ-hist-"));
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "b-summary.json"), summary({ generatedAt: "2026-08-03T10:00:00.000Z", commit: "ccc", totals: { pass: 95, fail: 5, assertions: 3100 } }));
  writeFileSync(join(dir, "nested", "a-summary.json"), summary({ generatedAt: "2026-08-02T10:00:00.000Z", commit: "bbb" }));
  writeFileSync(join(dir, "dup.json"), summary({ generatedAt: "2026-08-03T10:00:00.000Z", commit: "ccc", totals: { pass: 95, fail: 5, assertions: 3100 } }));
  writeFileSync(join(dir, "junk.json"), "{}");
  writeFileSync(join(dir, "notes.txt"), "ignored");

  it("finds only JSON files, recursively", () => {
    const files = findSummaryFiles([dir]);
    expect(files.some((f) => f.endsWith("notes.txt"))).toBe(false);
    expect(files.some((f) => f.endsWith(join("nested", "a-summary.json")))).toBe(true);
  });

  it("sorts by generated date, dedupes and skips junk", () => {
    const { history, skipped } = collectSummaryHistory(findSummaryFiles([dir]));
    expect(history.points.map((p) => p.commit)).toEqual(["bbb", "ccc"]);
    expect(skipped).toHaveLength(1);
  });

  it("ignores missing paths", () => {
    expect(findSummaryFiles([join(dir, "nope")])).toEqual([]);
  });
});

describe("rendering", () => {
  const history = collectSummaryHistory([]).history;

  it("renders an empty-state chart", () => {
    expect(renderFailureRateChart(history.points)).toContain("No summary.json files found");
    expect(renderSummaryHistoryMarkdown(history).join("\n")).toContain("No usable");
  });

  it("renders bars, a failure-rate line and a per-run table", () => {
    const pts = [
      parseSummaryPoint(summary())!,
      parseSummaryPoint(summary({ commit: "bbb", generatedAt: "2026-08-02T10:00:00.000Z", totals: { pass: 90, fail: 10, assertions: 3100 } }))!,
    ];
    const svg = renderFailureRateChart(pts);
    expect(svg).toContain("<svg");
    expect(svg).toContain("#dc2626");
    expect(svg).toContain("stroke-dasharray");
    const md = renderSummaryHistoryMarkdown({ points: pts }, { skipped: 1 }).join("\n");
    expect(md).toContain("Failure rate");
    expect(md).toContain("10.00%");
    expect(md).toContain("1 file(s) skipped");
    expect(md).toContain("🔴");
  });
});

const suiteSummary = (
  commit: string,
  at: string,
  suites: { id: string; pass: number; fail: number }[],
) =>
  JSON.stringify({
    generatedAt: at,
    commit,
    totals: {
      pass: suites.reduce((n, s) => n + s.pass, 0),
      fail: suites.reduce((n, s) => n + s.fail, 0),
      assertions: 100,
    },
    counterexamples: { total: 1, blocked: 1, leaked: 0 },
    suites,
  });

const suitePoints = () => [
  parseSummaryPoint(
    suiteSummary("c1", "2026-08-01T00:00:00.000Z", [
      { id: "encoding", pass: 40, fail: 0 },
      { id: "login", pass: 10, fail: 5 },
    ]),
  )!,
  parseSummaryPoint(
    suiteSummary("c2", "2026-08-02T00:00:00.000Z", [
      { id: "encoding", pass: 42, fail: 2 },
      { id: "login", pass: 15, fail: 0 },
    ]),
  )!,
];

describe("suite filters", () => {
  it("keeps per-suite pass/assertion counts when present", () => {
    const p = parseSummaryPoint(suiteSummary("c", "2026-08-01T00:00:00.000Z", [
      { id: "login", pass: 3, fail: 1 },
    ]))!;
    expect(p.suites[0]).toMatchObject({ id: "login", pass: 3, fail: 1 });
    expect(parseSummaryPoint(summary())!.suites[0]!.pass).toBeUndefined();
  });

  it("lists suite ids and per-suite totals", () => {
    const pts = suitePoints();
    expect(listSuiteIds(pts)).toEqual(["encoding", "login"]);
    expect(suiteTotals(pts)).toEqual([
      { id: "encoding", pass: 82, fail: 2, runs: 2 },
      { id: "login", pass: 25, fail: 5, runs: 2 },
    ]);
    expect(hasSuiteBreakdown(pts)).toBe(true);
    expect(hasSuiteBreakdown([parseSummaryPoint(summary())!])).toBe(false);
  });

  it("recomputes totals and failure rate from the selected suites only", () => {
    const [a, b] = applySuiteFilter(suitePoints(), ["encoding"]);
    expect(a!.totals).toEqual({ pass: 40, fail: 0, assertions: 0 });
    expect(b!.totals.fail).toBe(2);
    expect(failureRate(b!)).toBeCloseTo((2 / 44) * 100, 5);
    const login = applySuiteFilter(suitePoints(), ["login"]);
    expect(failureRate(login[0]!)).toBeCloseTo((5 / 15) * 100, 5);
  });

  it("passes points through for empty, full, or unfilterable selections", () => {
    const pts = suitePoints();
    expect(applySuiteFilter(pts, null)[0]!.totals.pass).toBe(50);
    expect(applySuiteFilter(pts, [])[0]!.totals.pass).toBe(50);
    expect(applySuiteFilter(pts, ["encoding", "login"])[0]!.totals.pass).toBe(50);
    const legacy = [parseSummaryPoint(summary())!];
    expect(applySuiteFilter(legacy, ["encoding"])[0]!.totals.pass).toBe(100);
  });

  it("parses suite filter strings and reports unknown ids", () => {
    const known = ["encoding", "login"];
    expect(parseSuiteFilter("login", known)).toEqual({ selected: ["login"], unknown: [] });
    expect(parseSuiteFilter("login, nope", known)).toEqual({
      selected: ["login"],
      unknown: ["nope"],
    });
    expect(parseSuiteFilter("all", known).selected).toBeNull();
    expect(parseSuiteFilter(null, known).selected).toBeNull();
    expect(parseSuiteFilter("", known).selected).toBeNull();
  });

  it("renders interactive checkboxes with the initial selection applied", () => {
    const html = renderSuiteFilterChart(suitePoints(), { selected: ["encoding"] });
    expect(html).toContain('data-suite="encoding"');
    expect(html).toContain('data-suite="login"');
    expect(html).toMatch(/data-suite="encoding" checked/);
    expect(html).not.toMatch(/data-suite="login" checked/);
    expect(html).toContain("data-suite-all");
    expect(html).toContain("Showing 1 of 2 suite(s).");
    expect(html).toContain("<svg");
  });

  it("falls back to the static chart when no per-suite pass counts exist", () => {
    const html = renderSuiteFilterChart([parseSummaryPoint(summary())!]);
    expect(html).not.toContain("data-suite=");
    expect(html).toContain("Suite filters need per-suite pass counts");
  });

  it("states the active filter and per-suite table in the markdown", () => {
    const pts = suitePoints();
    const md = renderSummaryHistoryMarkdown(
      { points: applySuiteFilter(pts, ["encoding"]) },
      { selected: ["encoding"], allSuites: listSuiteIds(pts), breakdown: suiteTotals(pts) },
    ).join("\n");
    expect(md).toContain("Suite filter active: **`encoding`** of 2 suite(s)");
    expect(md).toContain("| `login` | — | 2 | 25 | 5 |");
    expect(md).toContain("| `encoding` | ✅ | 2 | 82 | 2 |");
    expect(renderSummaryHistoryMarkdown({ points: pts }).join("\n")).toContain(
      "_All 2 suite(s) included._",
    );
  });
});

describe("hover tooltips", () => {
  const point = () =>
    parseSummaryPoint(
      summary({
        runId: "1234567890",
        runNumber: 42,
        totals: { pass: 90, fail: 10, assertions: 400 },
      }),
    )!;

  it("formats the exact date, run id, counts and failure rate", () => {
    const lines = pointTooltipLines(point());
    expect(lines).toEqual([
      "Date: 2026-08-01 10:00 UTC",
      "Run: 1234567890 (#42)",
      "Commit: aaaaaaaaaa",
      "Pass: 90",
      "Fail: 10",
      "Failure rate: 10.00% (10/100)",
    ]);
    expect(pointTooltip(point())).toContain("\n");
  });

  it("degrades gracefully without a run id or timestamp", () => {
    const p = parseSummaryPoint(summary({ generatedAt: "", runId: null }))!;
    const lines = pointTooltipLines(p);
    expect(lines[0]).toBe("Date: —");
    expect(lines[1]).toBe("Run: —");
    expect(formatRunDate("nonsense")).toBe("nonsense");
  });

  it("renders hover hit areas and the tooltip card in the static chart", () => {
    const svg = renderFailureRateChart([point()]);
    expect(svg).toContain('class="pt-hit"');
    expect(svg).toContain("data-tip=");
    expect(svg).toContain("Failure rate: 10.00%");
    expect(svg).toContain('class="pt-tip"');
  });

  it("carries date/run id into the interactive chart data and tooltips", () => {
    const html = renderSuiteFilterChart([
      parseSummaryPoint(
        summary({
          runId: "999",
          runNumber: 7,
          suites: [{ id: "encoding", pass: 90, fail: 10, assertions: 400 }],
          totals: { pass: 90, fail: 10, assertions: 400 },
        }),
      )!,
    ]);
    expect(html).toContain('"runId":"999"');
    expect(html).toContain('"date":"2026-08-01 10:00 UTC"');
    expect(html).toContain("tipLines");
    expect(html).toContain("pt-hit");
  });
});

describe("run deep links", () => {
  const linked = () =>
    parseSummaryPoint(
      summary({
        runId: "5551212",
        runNumber: 9,
        suites: [{ id: "encoding", pass: 90, fail: 10, assertions: 400 }],
        totals: { pass: 90, fail: 10, assertions: 400 },
      }),
    )!;
  const opts = { server: "https://github.com", repo: "o/r" };

  it("builds summary, log and artifact URLs for a known run", () => {
    const l = runLinks(linked(), opts);
    expect(l.summaryUrl).toBe("https://github.com/o/r/actions/runs/5551212#summary");
    expect(l.logUrl).toBe("https://github.com/o/r/actions/runs/5551212/job");
    expect(l.artifactsUrl).toBe("https://github.com/o/r/actions/runs/5551212#artifacts");
    expect(l.href).toBe(l.summaryUrl);
  });

  it("falls back to an in-page anchor without a repo or run id", () => {
    const l = runLinks(linked(), { server: "https://github.com", repo: null });
    expect(l.summaryUrl).toBeNull();
    expect(l.href).toBe("#run-5551212");
    expect(runLinks(parseSummaryPoint(summary())!, opts).href).toMatch(/^#run-/);
  });

  it("links every static chart column and lists printable links", () => {
    const svg = renderFailureRateChart([linked()], undefined, opts);
    expect(svg).toContain('href="https://github.com/o/r/actions/runs/5551212#summary"');
    expect(svg).toContain('target="_blank"');
    expect(svg).toContain("Open: run summary + CI log (click)");
    expect(svg).toContain('class="run-links"');
    expect(svg).toContain("/actions/runs/5551212/job");
  });

  it("passes link data to the interactive chart", () => {
    const html = renderSuiteFilterChart([linked()], { links: opts });
    expect(html).toContain('"href":"https://github.com/o/r/actions/runs/5551212#summary"');
    expect(html).toContain('"log":"https://github.com/o/r/actions/runs/5551212/job"');
    expect(html).toContain('"external":true');
  });

  it("adds a Links column to the run-summary markdown table", () => {
    const md = renderSummaryHistoryMarkdown({ points: [linked()] }, { links: opts }).join("\n");
    expect(md).toContain("| Run | Date | Pass | Fail | Failure rate | Links |");
    expect(md).toContain("[summary](https://github.com/o/r/actions/runs/5551212#summary)");
    expect(md).toContain("[log](https://github.com/o/r/actions/runs/5551212/job)");
    const local = renderSummaryHistoryMarkdown({ points: [linked()] }, { links: { repo: null } }).join("\n");
    expect(local).toContain('<a id="run-5551212"></a>');
  });
});
