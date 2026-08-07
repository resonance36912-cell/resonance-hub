import { describe, expect, test } from "bun:test";
import {
  collectPinIssues,
  describeIssue,
  formatIssueTable,
  isExemptSpec,
  isRangeSpec,
  parseLock,
  resolvedVersion,
} from "./pinned-deps";

/** bun.lock v1 shape: name -> [ "name@version", ... ]. */
function lock(entries: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, version]) => [name, [`${name}@${version}`, {}]]),
  );
}

describe("spec classification", () => {
  test("flags every range operator form", () => {
    for (const spec of ["^4.13.0", "~4.13.0", ">=4.0.0", "<5", "=4.13.0", "4.0.0 - 4.13.0", "4 || 5", "*", "latest"]) {
      expect(isRangeSpec(spec)).toBe(true);
    }
  });

  test("accepts exact versions including prerelease and build metadata", () => {
    for (const spec of ["4.13.0", "1.0.0-beta.3", "2.1.0+build.7"]) {
      expect(isRangeSpec(spec)).toBe(false);
    }
  });

  test("exempts non-registry protocols", () => {
    for (const spec of ["workspace:*", "link:../pkg", "file:./tgz", "github:o/r", "git+https://x/y.git", "npm:other@1.0.0", "catalog:default", "https://x/y.tgz"]) {
      expect(isExemptSpec(spec)).toBe(true);
    }
  });
});

describe("lockfile resolution", () => {
  test("splits scoped names on the final @", () => {
    const pkgs = lock({ "@types/node": "24.3.0", "axe-core": "4.13.0" });
    expect(resolvedVersion(pkgs, "@types/node")).toBe("24.3.0");
    expect(resolvedVersion(pkgs, "axe-core")).toBe("4.13.0");
  });

  test("returns null for absent packages", () => {
    expect(resolvedVersion(lock({ a: "1.0.0" }), "b")).toBeNull();
  });

  test("parses JSONC lockfiles with comments and trailing commas", () => {
    const parsed = parseLock(`{\n  // a comment\n  "packages": { "a": ["a@1.0.0"], },\n}`);
    expect(resolvedVersion(parsed.packages ?? {}, "a")).toBe("1.0.0");
  });
});

describe("collectPinIssues", () => {
  test("passes a fully pinned, lock-matching manifest", () => {
    const issues = collectPinIssues({
      pkg: { dependencies: { axe: "4.13.0" }, devDependencies: { vite: "7.0.0" } },
      lockPkgs: lock({ axe: "4.13.0", vite: "7.0.0" }),
    });
    expect(issues).toEqual([]);
  });

  test("reports a range and the exact version bun.lock resolves", () => {
    const issues = collectPinIssues({
      pkg: { devDependencies: { "axe-core": "^4.13.0" } },
      lockPkgs: lock({ "axe-core": "4.13.0" }),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "range",
      section: "devDependencies",
      name: "axe-core",
      spec: "^4.13.0",
      resolved: "4.13.0",
    });
    // The regression that broke the production build must name both versions.
    expect(describeIssue(issues[0]!)).toContain("devDependencies.axe-core");
    expect(describeIssue(issues[0]!)).toContain('pin it to "4.13.0"');
  });

  test("reports an exact pin that disagrees with the lockfile", () => {
    const issues = collectPinIssues({
      pkg: { dependencies: { zod: "4.1.0" } },
      lockPkgs: lock({ zod: "4.2.1" }),
    });
    expect(issues[0]).toMatchObject({ kind: "mismatch", spec: "4.1.0", resolved: "4.2.1" });
    expect(describeIssue(issues[0]!)).toContain('bun.lock resolves "4.2.1"');
  });

  test("reports a dependency missing from the lockfile", () => {
    const issues = collectPinIssues({
      pkg: { dependencies: { ghost: "1.0.0" } },
      lockPkgs: lock({}),
    });
    expect(issues[0]).toMatchObject({ kind: "missing", resolved: null });
    expect(describeIssue(issues[0]!)).toContain("not present in bun.lock");
  });

  test("skips exempt protocols in every section", () => {
    const issues = collectPinIssues({
      pkg: {
        dependencies: { local: "workspace:*" },
        overrides: { patched: "npm:other@1.2.3" },
      },
      lockPkgs: lock({}),
    });
    expect(issues).toEqual([]);
  });

  test("checks overrides for exactness but not lockfile presence", () => {
    const issues = collectPinIssues({
      pkg: {
        overrides: { "brace-expansion": "2.0.2", "js-yaml": "^4.2.0" },
        pnpm: { overrides: { tar: ">=6" } },
      },
      lockPkgs: lock({}),
    });
    // "brace-expansion" is exact and absent from the lock -> not an issue.
    expect(issues.map((i) => `${i.section}.${i.name}`)).toEqual([
      "overrides.js-yaml",
      "pnpm.overrides.tar",
    ]);
    expect(issues.every((i) => i.kind === "range")).toBe(true);
  });

  test("collects offenders across all sections at once", () => {
    const issues = collectPinIssues({
      pkg: {
        dependencies: { a: "^1.0.0", b: "2.0.0" },
        devDependencies: { c: "3.0.0" },
        overrides: { d: "~4.0.0" },
      },
      lockPkgs: lock({ a: "1.2.3", b: "2.0.1", c: "3.0.0" }),
    });
    expect(issues.map((i) => [i.name, i.kind])).toEqual([
      ["a", "range"],
      ["b", "mismatch"],
      ["d", "range"],
    ]);
  });
});

describe("formatIssueTable", () => {
  test("shows declared, resolved, and fix columns", () => {
    const table = formatIssueTable(
      collectPinIssues({
        pkg: { devDependencies: { "axe-core": "^4.13.0" }, dependencies: { ghost: "1.0.0" } },
        lockPkgs: lock({ "axe-core": "4.13.0" }),
      }),
    );
    expect(table).toContain("DEPENDENCY");
    expect(table).toContain("PACKAGE.JSON");
    expect(table).toContain("BUN.LOCK");
    expect(table).toContain("devDependencies.axe-core");
    expect(table).toContain("^4.13.0");
    expect(table).toContain("pin to 4.13.0");
    // Absent from the lockfile renders explicitly, not as blank space.
    expect(table).toContain("(absent)");
    expect(table).toContain("bun install");
  });
});
