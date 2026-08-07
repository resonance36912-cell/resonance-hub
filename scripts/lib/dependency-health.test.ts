import { describe, expect, it } from "vitest";
import {
  currentPercent,
  groupByBump,
  healthPosture,
  parseDependencyHealth,
  reportAge,
} from "../../src/lib/dependency-health";

const REPORT = `<!-- reson8:outdated-pins -->

## Outdated pinned dependencies — update plan

Checked **92** exact pins against the npm \`latest\` dist-tag on 2026-08-07T15:05:11.182Z.

**3 outdated** — 1 major, 1 minor, 1 patch, 0 prerelease.

Nothing in the repo was changed by this check: pins, \`bun.lock\`, and overrides are untouched.

| Dependency | Section | Pinned | Latest | Bump |
| --- | --- | --- | --- | --- |
| \`typescript\` | dev | \`5.9.3\` | \`7.0.2\` | major |
| \`date-fns\` | prod | \`4.1.0\` | \`4.4.0\` | minor |
| \`fflate\` | prod | \`0.8.2\` | \`0.8.3\` | patch |
`;

describe("parseDependencyHealth", () => {
  it("reads the summary line", () => {
    const r = parseDependencyHealth(REPORT);
    expect(r.totalPins).toBe(92);
    expect(r.checkedAt).toBe("2026-08-07T15:05:11.182Z");
    expect(r.outdatedCount).toBe(3);
    expect(r.currentCount).toBe(89);
    expect(r.allCurrent).toBe(false);
  });

  it("counts bumps from the rows, not the prose", () => {
    const r = parseDependencyHealth(REPORT);
    expect(r.counts).toEqual({ major: 1, minor: 1, patch: 1, prerelease: 0 });
  });

  it("parses rows with markdown stripped", () => {
    const r = parseDependencyHealth(REPORT);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({
      name: "typescript",
      section: "dev",
      pinned: "5.9.3",
      latest: "7.0.2",
      bump: "major",
    });
  });

  it("skips the header and separator rows", () => {
    const r = parseDependencyHealth(REPORT);
    expect(r.rows.some((row) => row.name === "Dependency")).toBe(false);
    expect(r.rows.some((row) => row.name.startsWith("-"))).toBe(false);
  });

  it("keeps prose as notes without the marker comment or headings", () => {
    const r = parseDependencyHealth(REPORT);
    expect(r.notes.join(" ")).toContain("Nothing in the repo was changed");
    expect(r.notes.join(" ")).not.toContain("reson8:outdated-pins");
    expect(r.notes.join(" ")).not.toContain("update plan");
  });

  it("handles the all-current report", () => {
    const md = `Checked **92** exact pins against the npm \`latest\` dist-tag on 2026-08-07T15:05:11.182Z.\n\nEverything is current.\n`;
    const r = parseDependencyHealth(md);
    expect(r.allCurrent).toBe(true);
    expect(r.outdatedCount).toBe(0);
    expect(r.currentCount).toBe(92);
    expect(currentPercent(r)).toBe(100);
  });

  it("degrades instead of throwing on empty or junk input", () => {
    for (const input of ["", "not a report", "| broken |"]) {
      const r = parseDependencyHealth(input);
      expect(r.rows).toEqual([]);
      expect(r.allCurrent).toBe(true);
      expect(currentPercent(r)).toBe(100);
    }
  });

  it("falls back to the declared summary when the table is missing", () => {
    const md = `Checked **10** exact pins against the npm \`latest\` dist-tag on 2026-08-07T15:05:11.182Z.\n\n**4 outdated** — 2 major, 1 minor, 1 patch, 0 prerelease.\n`;
    const r = parseDependencyHealth(md);
    expect(r.outdatedCount).toBe(4);
    expect(r.counts).toEqual({ major: 2, minor: 1, patch: 1, prerelease: 0 });
  });

  it("parses the real committed report", async () => {
    const md = await Bun.file("reports/outdated-pins.md").text();
    const r = parseDependencyHealth(md);
    expect(r.totalPins).toBeGreaterThan(0);
    expect(r.rows.length).toBe(r.outdatedCount);
    const summed =
      r.counts.major + r.counts.minor + r.counts.patch + r.counts.prerelease;
    expect(summed).toBe(r.rows.length);
    expect(r.currentCount + r.outdatedCount).toBe(r.totalPins);
  });
});

describe("groupByBump", () => {
  it("orders major → prerelease and drops empty groups", () => {
    const r = parseDependencyHealth(REPORT);
    expect(groupByBump(r.rows).map((g) => g.bump)).toEqual([
      "major",
      "minor",
      "patch",
    ]);
  });
});

describe("healthPosture", () => {
  it("flags majors for review", () => {
    const p = healthPosture(parseDependencyHealth(REPORT));
    expect(p.tone).toBe("attention");
    expect(p.detail).toContain("1 pin has a new major");
  });

  it("calls minor/patch-only drift low risk", () => {
    const md = REPORT.replace("| major |", "| patch |");
    const p = healthPosture(parseDependencyHealth(md));
    expect(p.tone).toBe("watch");
    expect(p.label).toBe("Low-risk drift only");
  });

  it("reports all-current cleanly", () => {
    const p = healthPosture(parseDependencyHealth("Everything is current."));
    expect(p.tone).toBe("good");
    expect(p.label).toBe("All current");
  });
});

describe("reportAge", () => {
  const at = "2026-08-01T00:00:00.000Z";
  it("returns day counts", () => {
    expect(reportAge(at, new Date("2026-08-02T01:00:00Z"))?.label).toBe("yesterday");
    expect(reportAge(at, new Date("2026-08-06T00:00:00Z"))?.label).toBe("5 days ago");
  });
  it("handles sub-day and future timestamps", () => {
    expect(reportAge(at, new Date("2026-08-01T00:30:00Z"))?.label).toBe(
      "in the last hour",
    );
    expect(reportAge(at, new Date("2026-07-31T00:00:00Z"))?.label).toBe("just now");
  });
  it("returns null for missing or unparseable timestamps", () => {
    expect(reportAge(null)).toBeNull();
    expect(reportAge("not-a-date")).toBeNull();
  });
});
