import { describe, expect, it } from "vitest";
import {
  REPORT_FALLBACK,
  REPORT_PATH,
  reportSource,
} from "../../src/lib/dependency-health-source";
import { parseDependencyHealth } from "../../src/lib/dependency-health";

describe("dependency-health report source", () => {
  it("never throws at module load and always yields a known status", () => {
    expect(["ok", "missing", "unreadable"]).toContain(reportSource.status);
    expect(typeof reportSource.source).toBe("string");
  });

  it("keeps source empty unless the report is actually present", () => {
    if (reportSource.status !== "ok") {
      expect(reportSource.source).toBe("");
    } else {
      expect(reportSource.source.trim().length).toBeGreaterThan(0);
    }
  });

  it("parses whatever the loader produced without throwing", () => {
    const report = parseDependencyHealth(reportSource.source);
    expect(report.totalPins).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.rows)).toBe(true);
  });

  it("provides a clear, actionable fallback message per failure mode", () => {
    for (const key of ["missing", "unreadable"] as const) {
      const f = REPORT_FALLBACK[key];
      expect(f.label.length).toBeGreaterThan(8);
      expect(f.detail).toContain(REPORT_PATH);
      // no scary wording — the page is fine, the artifact is just absent
      expect(f.detail.toLowerCase()).not.toContain("error");
    }
    expect(REPORT_FALLBACK.missing.detail).toContain("not committed");
  });
});
