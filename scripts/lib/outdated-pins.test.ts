import { describe, expect, it } from "vitest";
import {
  ISSUE_MARKER,
  ISSUE_TITLE,
  classifyBump,
  collectPins,
  compareSemver,
  countByBump,
  evaluatePin,
  parseSemver,
  renderIssueBody,
  renderSummaryLine,
  reportFingerprint,
  sortOutdated,
  type OutdatedDep,
  type OutdatedReport,
} from "./outdated-pins";

const dep = (over: Partial<OutdatedDep> = {}): OutdatedDep => ({
  section: "dependencies",
  name: "zod",
  current: "4.4.3",
  latest: "4.5.0",
  bump: "minor",
  ...over,
});

const report = (over: Partial<OutdatedReport> = {}): OutdatedReport => ({
  generatedAt: "2026-08-07T00:00:00.000Z",
  total: 10,
  outdated: [],
  skipped: [],
  ...over,
});

describe("parseSemver", () => {
  it("parses plain versions", () => {
    expect(parseSemver("4.13.0")).toEqual({ major: 4, minor: 13, patch: 0, pre: null });
  });

  it("parses prerelease and build suffixes", () => {
    expect(parseSemver("1.0.0-rc.1")?.pre).toBe("rc.1");
    expect(parseSemver("1.0.0+build.5")?.pre).toBe("build.5");
  });

  it("rejects non-semver specs", () => {
    for (const bad of ["^1.0.0", "1.0", "latest", "", "next", "1.x"]) {
      expect(parseSemver(bad)).toBeNull();
    }
  });
});

describe("compareSemver", () => {
  const p = (v: string) => parseSemver(v)!;

  it("orders by major, then minor, then patch", () => {
    expect(compareSemver(p("2.0.0"), p("1.9.9"))).toBe(1);
    expect(compareSemver(p("1.2.0"), p("1.10.0"))).toBe(-1);
    expect(compareSemver(p("1.2.3"), p("1.2.3"))).toBe(0);
  });

  it("sorts a prerelease below its release", () => {
    expect(compareSemver(p("2.0.0-rc.1"), p("2.0.0"))).toBe(-1);
    expect(compareSemver(p("2.0.0"), p("2.0.0-rc.1"))).toBe(1);
  });
});

describe("classifyBump", () => {
  const p = (v: string) => parseSemver(v)!;

  it("labels each bump kind", () => {
    expect(classifyBump(p("1.0.0"), p("2.0.0"))).toBe("major");
    expect(classifyBump(p("1.0.0"), p("1.1.0"))).toBe("minor");
    expect(classifyBump(p("1.0.0"), p("1.0.1"))).toBe("patch");
    expect(classifyBump(p("1.0.0-rc.1"), p("1.0.0"))).toBe("prerelease");
  });

  it("treats 0.x minor bumps as minor, not major", () => {
    // Reporting only — the plan groups these under low-risk, and the reviewer
    // decides. We do not silently promote 0.x minors to "major".
    expect(classifyBump(p("0.4.0"), p("0.5.0"))).toBe("minor");
  });
});

describe("collectPins", () => {
  it("collects exact pins from both dependency sections, sorted", () => {
    expect(
      collectPins({
        dependencies: { zod: "4.4.3", react: "19.0.0" },
        devDependencies: { "axe-core": "4.13.0" },
      }),
    ).toEqual([
      { section: "devDependencies", name: "axe-core", current: "4.13.0" },
      { section: "dependencies", name: "react", current: "19.0.0" },
      { section: "dependencies", name: "zod", current: "4.4.3" },
    ]);
  });

  it("skips ranges and non-registry protocols", () => {
    const pins = collectPins({
      dependencies: {
        ranged: "^1.0.0",
        tilde: "~1.0.0",
        star: "*",
        tagged: "latest",
        local: "file:../pkg",
        ws: "workspace:*",
        good: "1.2.3",
      },
    });
    expect(pins.map((p) => p.name)).toEqual(["good"]);
  });

  it("ignores overrides (transitive advisory pins are not actionable here)", () => {
    expect(collectPins({ overrides: { "brace-expansion": "2.0.2" } })).toEqual([]);
  });

  it("tolerates a package.json with no dependency sections", () => {
    expect(collectPins({ name: "hub" })).toEqual([]);
  });
});

describe("evaluatePin", () => {
  const pin = { section: "dependencies" as const, name: "zod", current: "4.4.3" };

  it("reports an outdated pin with its bump kind", () => {
    expect(evaluatePin(pin, "5.0.0").outdated).toMatchObject({ latest: "5.0.0", bump: "major" });
  });

  it("reports nothing when the pin is current", () => {
    expect(evaluatePin(pin, "4.4.3")).toEqual({});
  });

  it("reports nothing when the pin is AHEAD of latest", () => {
    // Happens when we pin a version that was later unpublished/deprecated off
    // the latest tag; do not suggest a downgrade.
    expect(evaluatePin(pin, "4.4.2")).toEqual({});
  });

  it("skips unparseable versions on either side", () => {
    expect(evaluatePin(pin, null).skipped?.reason).toMatch(/no latest version/);
    expect(evaluatePin(pin, "not-a-version").skipped?.reason).toMatch(/not semver/);
    expect(evaluatePin({ ...pin, current: "1.x" }, "2.0.0").skipped?.reason).toMatch(/not semver/);
  });
});

describe("sortOutdated / countByBump", () => {
  it("puts majors first, then minor, patch, prerelease; alphabetical within a group", () => {
    const rows = sortOutdated([
      dep({ name: "b", bump: "patch" }),
      dep({ name: "z", bump: "major" }),
      dep({ name: "a", bump: "patch" }),
      dep({ name: "c", bump: "minor" }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["z", "c", "a", "b"]);
  });

  it("counts each bump kind", () => {
    expect(countByBump([dep({ bump: "major" }), dep({ bump: "patch" }), dep()])).toEqual({
      major: 1,
      minor: 1,
      patch: 1,
      prerelease: 0,
    });
  });
});

describe("reportFingerprint", () => {
  it("ignores the timestamp and input order", () => {
    const a = report({ generatedAt: "2026-01-01T00:00:00Z", outdated: [dep({ name: "a" }), dep({ name: "b" })] });
    const b = report({ generatedAt: "2026-08-07T00:00:00Z", outdated: [dep({ name: "b" }), dep({ name: "a" })] });
    expect(reportFingerprint(a)).toBe(reportFingerprint(b));
  });

  it("changes when a target version changes", () => {
    expect(reportFingerprint(report({ outdated: [dep({ latest: "4.5.0" })] }))).not.toBe(
      reportFingerprint(report({ outdated: [dep({ latest: "4.6.0" })] })),
    );
  });

  it("is empty for a clean report", () => {
    expect(reportFingerprint(report())).toBe("");
  });
});

describe("renderIssueBody", () => {
  it("includes the dedupe marker and title", () => {
    const body = renderIssueBody(report());
    expect(body.startsWith(ISSUE_MARKER)).toBe(true);
    expect(body).toContain(ISSUE_TITLE);
  });

  it("states plainly that nothing was changed", () => {
    expect(renderIssueBody(report({ outdated: [dep()] }))).toContain("Nothing in the repo was changed");
  });

  it("celebrates a clean report without emitting a plan", () => {
    const body = renderIssueBody(report());
    expect(body).toContain("Every pin is already at the latest published version");
    expect(body).not.toContain("Ready-to-apply plan");
  });

  it("emits a copy-pasteable pin block for patch + minor updates", () => {
    const body = renderIssueBody(
      report({ outdated: [dep({ name: "zod", current: "4.4.3", latest: "4.5.0", bump: "minor" })] }),
    );
    expect(body).toContain('"zod": "4.5.0",   // was 4.4.3 (dependencies)');
    expect(body).toContain("bun run scripts/verify-deps-pinned.ts");
  });

  it("lists majors as individual checkboxes with a versions link", () => {
    const body = renderIssueBody(
      report({ outdated: [dep({ name: "react", current: "19.0.0", latest: "20.0.0", bump: "major" })] }),
    );
    expect(body).toContain("- [ ] `react` `19.0.0` → `20.0.0`");
    expect(body).toContain("https://www.npmjs.com/package/react?activeTab=versions");
  });

  it("numbers the majors section 1 when there are no low-risk updates", () => {
    const body = renderIssueBody(report({ outdated: [dep({ bump: "major", latest: "5.0.0" })] }));
    expect(body).toContain("**1. Majors (1)**");
    expect(body).not.toContain("Low-risk");
  });

  it("reminds the reader to commit package.json and bun.lock together", () => {
    expect(renderIssueBody(report({ outdated: [dep()] }))).toContain("bun.lock` in the same commit");
  });

  it("surfaces skipped dependencies with their reason", () => {
    const body = renderIssueBody(
      report({ skipped: [{ section: "dependencies", name: "ghost", current: "1.0.0", reason: "package not found on the registry" }] }),
    );
    expect(body).toContain("Not evaluated (1)");
    expect(body).toContain("`ghost` (`1.0.0`) — package not found on the registry");
  });

  it("links the CI run when one is known", () => {
    expect(renderIssueBody(report(), { runUrl: "https://example.test/run/1" })).toContain(
      "([run](https://example.test/run/1))",
    );
    expect(renderIssueBody(report())).not.toContain("([run]");
  });
});

describe("renderSummaryLine", () => {
  it("summarises a dirty report", () => {
    expect(renderSummaryLine(report({ total: 5, outdated: [dep({ bump: "major" }), dep()] }))).toBe(
      "2/5 pins outdated (1 major, 1 minor, 0 patch)",
    );
  });

  it("summarises a clean report", () => {
    expect(renderSummaryLine(report({ total: 5 }))).toBe("all 5 pins up to date");
  });
});
