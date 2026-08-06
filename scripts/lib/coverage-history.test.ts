import { describe, it, expect } from "vitest";
import {
  appendHistoryPoint,
  findRegressions,
  parseHistory,
  renderHistoryChart,
  renderHistoryMarkdown,
  sparkline,
  HISTORY_LIMIT,
  type HistoryPoint,
} from "./coverage-history";

const point = (over: Partial<HistoryPoint> = {}): HistoryPoint => ({
  runId: "1",
  runNumber: 1,
  commit: "abcdef123456",
  branch: "main",
  event: "push",
  generatedAt: "2026-01-01T00:00:00.000Z",
  totals: { pass: 10, fail: 0, assertions: 100 },
  counterexamples: { total: 27, blocked: 27, leaked: 0 },
  suites: [{ id: "fuzz", fail: 0 }],
  ...over,
});

describe("coverage history", () => {
  it("tolerates missing or corrupt history files", () => {
    expect(parseHistory(null).points).toEqual([]);
    expect(parseHistory("not json").points).toEqual([]);
    expect(parseHistory('{"points":"nope"}').points).toEqual([]);
  });

  it("appends, de-dupes re-runs of the same run id, and caps the window", () => {
    let h = { points: [point({ runId: "1" })] };
    h = appendHistoryPoint(h, point({ runId: "1", totals: { pass: 12, fail: 0, assertions: 120 } }));
    expect(h.points).toHaveLength(1);
    expect(h.points[0]!.totals.pass).toBe(12);

    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      h = appendHistoryPoint(h, point({ runId: String(100 + i) }));
    }
    expect(h.points).toHaveLength(HISTORY_LIMIT);
    expect(h.points.at(-1)!.runId).toBe(String(100 + HISTORY_LIMIT + 4));
  });

  it("flags red runs from failing tests or leaked counterexamples", () => {
    const h = {
      points: [
        point({ runId: "a" }),
        point({ runId: "b", totals: { pass: 9, fail: 1, assertions: 90 } }),
        point({ runId: "c", counterexamples: { total: 27, blocked: 26, leaked: 1 } }),
      ],
    };
    expect(findRegressions(h).map((p) => p.runId)).toEqual(["b", "c"]);
  });

  it("renders sparklines of the right length", () => {
    expect(sparkline([])).toBe("(no history)");
    expect(sparkline([1, 2, 3])).toHaveLength(3);
    expect(sparkline([0, 0, 0])).toBe("▁▁▁");
  });

  it("renders charts and markdown, and degrades with a single run", () => {
    const svg = renderHistoryChart({
      title: "Test results per run",
      points: [point({ runId: "a" }), point({ runId: "b", totals: { pass: 9, fail: 2, assertions: 90 } })],
      good: (p) => p.totals.pass,
      bad: (p) => p.totals.fail,
      goodLabel: "passing",
      badLabel: "failing",
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect"); // failing bar drawn
    expect(renderHistoryChart({
      title: "t", points: [], good: () => 0, bad: () => 0, goodLabel: "g", badLabel: "b",
    })).toContain("No history yet");

    expect(renderHistoryMarkdown({ points: [point()] }).join("\n")).toContain("Not enough history");
    const md = renderHistoryMarkdown({
      points: [point({ runId: "a" }), point({ runId: "b", counterexamples: { total: 27, blocked: 26, leaked: 1 } })],
    }).join("\n");
    expect(md).toContain("Counterexamples leaked");
    expect(md).toContain("1 red run(s)");
  });
});
