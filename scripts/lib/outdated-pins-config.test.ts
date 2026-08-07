import { describe, expect, it } from "vitest";
import {
  applyConfig,
  configureReport,
  DEFAULT_CONFIG,
  describeConfig,
  matchesPattern,
  meetsReportingFloor,
  parseAuditConfig,
} from "./outdated-pins-config";
import type { Bump, OutdatedDep, OutdatedReport } from "./outdated-pins";

const dep = (name: string, bump: Bump): OutdatedDep => ({
  section: "dependencies",
  name,
  current: "1.0.0",
  latest: "1.1.0",
  bump,
});

describe("parseAuditConfig", () => {
  it("falls back to the documented defaults on an empty env", () => {
    expect(parseAuditConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("reads every knob", () => {
    expect(
      parseAuditConfig({
        PINS_MIN_BUMP: "Minor",
        PINS_IGNORE_BUMPS: "prerelease, patch",
        PINS_IGNORE: "@types/*, vite",
        PINS_ONLY: "react*",
        PINS_MIN_OUTDATED: "3",
        PINS_FAIL_ON_MAJOR: "true",
      }),
    ).toEqual({
      minBump: "minor",
      ignoreBumps: ["prerelease", "patch"],
      ignore: ["@types/*", "vite"],
      only: ["react*"],
      minOutdated: 3,
      failOnMajor: true,
    });
  });

  it("treats an explicit empty list as 'ignore nothing'", () => {
    expect(parseAuditConfig({ PINS_IGNORE_BUMPS: "" }).ignoreBumps).toEqual([]);
  });

  it("rejects typos rather than silently muting the audit", () => {
    expect(() => parseAuditConfig({ PINS_MIN_BUMP: "pathc" })).toThrow(/PINS_MIN_BUMP/);
    expect(() => parseAuditConfig({ PINS_IGNORE_BUMPS: "majro" })).toThrow(/PINS_IGNORE_BUMPS/);
    expect(() => parseAuditConfig({ PINS_MIN_OUTDATED: "-1" })).toThrow(/PINS_MIN_OUTDATED/);
    expect(() => parseAuditConfig({ PINS_FAIL_ON_MAJOR: "maybe" })).toThrow(/PINS_FAIL_ON_MAJOR/);
  });
});

describe("matchesPattern", () => {
  it("matches exact names and globs only", () => {
    expect(matchesPattern("vite", "vite")).toBe(true);
    expect(matchesPattern("@types/node", "@types/*")).toBe(true);
    expect(matchesPattern("eslint-plugin-x", "eslint-*")).toBe(true);
    expect(matchesPattern("vitest", "vite")).toBe(false);
    expect(matchesPattern("react", "*")).toBe(true);
  });
});

describe("applyConfig", () => {
  const deps = [dep("react", "minor"), dep("vite", "patch"), dep("zod", "major"), dep("next", "prerelease")];

  it("drops prereleases by default and keeps the rest", () => {
    const { kept, excluded } = applyConfig(deps, DEFAULT_CONFIG);
    expect(kept.map((d) => d.name)).toEqual(["react", "vite", "zod"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]!.reason).toMatch(/PINS_IGNORE_BUMPS/);
  });

  it("raises the floor with minBump", () => {
    const { kept } = applyConfig(deps, { ...DEFAULT_CONFIG, minBump: "major" });
    expect(kept.map((d) => d.name)).toEqual(["zod"]);
  });

  it("honours ignore globs and only-lists", () => {
    expect(applyConfig(deps, { ...DEFAULT_CONFIG, ignore: ["vi*"] }).kept.map((d) => d.name)).toEqual([
      "react",
      "zod",
    ]);
    expect(applyConfig(deps, { ...DEFAULT_CONFIG, only: ["react"] }).kept.map((d) => d.name)).toEqual([
      "react",
    ]);
  });
});

describe("meetsReportingFloor", () => {
  it("never files on zero findings and respects the configured floor", () => {
    expect(meetsReportingFloor(0, DEFAULT_CONFIG)).toBe(false);
    expect(meetsReportingFloor(1, DEFAULT_CONFIG)).toBe(true);
    expect(meetsReportingFloor(2, { ...DEFAULT_CONFIG, minOutdated: 3 })).toBe(false);
    expect(meetsReportingFloor(3, { ...DEFAULT_CONFIG, minOutdated: 3 })).toBe(true);
    expect(meetsReportingFloor(0, { ...DEFAULT_CONFIG, minOutdated: 0 })).toBe(false);
  });
});

describe("configureReport", () => {
  it("moves muted findings into skipped with their reason", () => {
    const report: OutdatedReport = {
      generatedAt: "2026-08-07T00:00:00.000Z",
      total: 4,
      outdated: [dep("react", "minor"), dep("next", "prerelease")],
      skipped: [{ section: "dependencies", name: "x", current: "1.0.0", reason: "registry down" }],
    };
    const out = configureReport(report, DEFAULT_CONFIG);
    expect(out.outdated.map((d) => d.name)).toEqual(["react"]);
    expect(out.skipped).toHaveLength(2);
    expect(out.skipped[1]!.name).toBe("next");
  });
});

describe("describeConfig", () => {
  it("echoes the active config for the run log", () => {
    expect(describeConfig(DEFAULT_CONFIG)).toContain("min bump: patch");
    expect(describeConfig(DEFAULT_CONFIG)).toContain("only: all pins");
  });
});
