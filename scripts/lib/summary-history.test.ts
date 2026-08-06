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
