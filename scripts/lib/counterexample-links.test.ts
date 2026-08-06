import { describe, expect, it } from "bun:test";
import {
  counterexampleLinks,
  counterexampleLogLines,
  counterexampleMarkdown,
  counterexampleStoreJson,
  extractCounterexamples,
  renderCounterexampleLinksHtml,
  renderCounterexamplesHtml,
} from "./counterexample-links";

const OUTPUT = `
(fail) rejects hostile return_to > allowlist [1ms]
  Counterexample: ["https://evil.example//reson8.life"]
  Expected: "deny"
  Received: "allow"
× normalizes uppercase host
  Received: "HTTPS://Reson8.LIFE/checkout"
`;

describe("extractCounterexamples", () => {
  it("captures fast-check, received, expected and literal inputs", () => {
    const items = extractCounterexamples("fuzz", OUTPUT);
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has("fast-check")).toBe(true);
    expect(kinds.has("received")).toBe(true);
    expect(items.some((i) => i.input.includes("evil.example"))).toBe(true);
    expect(items.every((i) => i.id.startsWith("fuzz-"))).toBe(true);
    expect(items[0]?.index).toBe(1);
  });

  it("dedupes identical values and attaches the nearest test name", () => {
    const items = extractCounterexamples("fuzz", `${OUTPUT}${OUTPUT}`);
    const inputs = items.map((i) => `${i.kind}:${i.input}`);
    expect(new Set(inputs).size).toBe(inputs.length);
    expect(items.some((i) => (i.testName ?? "").length > 0)).toBe(true);
  });

  it("returns nothing for clean output", () => {
    expect(extractCounterexamples("fuzz", "42 pass\n0 fail\n")).toEqual([]);
  });
});

describe("links", () => {
  const cx = extractCounterexamples("fuzz", OUTPUT)[0]!;

  it("builds relative report anchors and an admin deep link", () => {
    const l = counterexampleLinks(cx);
    expect(l.report).toBe("counterexamples/return-to-counterexamples-fuzz.html#cx-1");
    expect(l.admin).toContain("https://reson8.life/admin/return-to-counterexamples?input=");
    expect(l.admin).toContain(encodeURIComponent(cx.input));
  });

  it("honours absolute bases", () => {
    const l = counterexampleLinks(cx, {
      reportBaseUrl: "https://reports.example/run/1/",
      hubUrl: "https://staging.reson8.life/",
    });
    expect(l.report.startsWith("https://reports.example/run/1/counterexamples/")).toBe(true);
    expect(l.admin.startsWith("https://staging.reson8.life/admin/")).toBe(true);
  });
});

describe("renderers", () => {
  const items = extractCounterexamples("fuzz", OUTPUT);

  it("renders anchored cards with escaped inputs", () => {
    const html = renderCounterexamplesHtml("fuzz", "Fuzz suite", items, { Commit: "abc123" });
    expect(html).toContain('id="cx-1"');
    expect(html).not.toContain("<script");
    expect(html).toContain("Fuzz suite");
  });

  it("emits clickable log, markdown and trend-alert links", () => {
    const log = counterexampleLogLines("Fuzz suite", items);
    expect(log[0]).toStartWith("::error::NEW FAILURE input #1");
    expect(log[0]).toContain("admin:");
    expect(counterexampleMarkdown("Fuzz suite", items).join("\n")).toContain("](https://reson8.life/admin/");
    expect(
      renderCounterexampleLinksHtml([{ suiteId: "fuzz", suiteTitle: "Fuzz suite", items }]),
    ).toContain("#cx-1");
  });

  it("stores every input verbatim in JSON", () => {
    const parsed = JSON.parse(counterexampleStoreJson("fuzz", "Fuzz suite", items, {}));
    expect(parsed.count).toBe(items.length);
    expect(parsed.counterexamples[0].links.report).toContain("#cx-1");
  });
});
