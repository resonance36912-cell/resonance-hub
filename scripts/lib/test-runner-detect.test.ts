import { describe, expect, it } from "bun:test";
import {
  RUNNER_LABEL,
  detectRunner,
  parseRunnerOutput,
  runnerCommand,
  stripAnsi,
} from "./test-runner-detect";

describe("detectRunner", () => {
  it("picks bun for a bun:test import", () => {
    expect(detectRunner("x.test.ts", 'import { it } from "bun:test";').runner).toBe("bun");
  });

  it("picks vitest for a vitest import", () => {
    const d = detectRunner("x.test.ts", 'import { describe, it } from "vitest";');
    expect(d.runner).toBe("vitest");
    expect(d.reason).toContain("vitest");
  });

  it("prefers bun:test when both are imported", () => {
    expect(
      detectRunner("x.test.ts", 'import { it } from "bun:test";\nimport { fc } from "vitest";')
        .runner,
    ).toBe("bun");
  });

  it("handles require() form and single quotes", () => {
    expect(detectRunner("x.test.ts", "const { it } = require('vitest')").runner).toBe("vitest");
  });

  it("defaults to bun when no framework import is present", () => {
    const d = detectRunner("x.test.ts", "export const noop = 1;");
    expect(d.runner).toBe("bun");
    expect(d.reason).toContain("defaulted");
  });

  it("ignores lookalike specifiers", () => {
    expect(detectRunner("x.test.ts", 'import x from "vitest-mock-extended";').runner).toBe("bun");
    expect(detectRunner("x.test.ts", 'import x from "@vitest/utils";').runner).toBe("bun");
  });

  it("defaults to bun for an unreadable file", () => {
    expect(detectRunner("/nope/does-not-exist.test.ts").runner).toBe("bun");
  });

  it("detects the real repo suites", () => {
    expect(detectRunner("scripts/lib/return-to-allowlist-fuzz.test.ts").runner).toBe("bun");
    expect(detectRunner("scripts/lib/return-to-allowlist-encoding.test.ts").runner).toBe("vitest");
  });
});

describe("runnerCommand", () => {
  it("builds bun and vitest commands", () => {
    expect(runnerCommand("bun", "a.test.ts")).toEqual(["bun", "test", "a.test.ts"]);
    expect(runnerCommand("vitest", "a.test.ts")).toEqual([
      "bunx",
      "vitest",
      "run",
      "--reporter=default",
      "a.test.ts",
    ]);
  });

  it("labels both runners", () => {
    expect(RUNNER_LABEL.bun).toBe("bun:test");
    expect(RUNNER_LABEL.vitest).toBe("vitest");
  });
});

describe("parseRunnerOutput — bun:test", () => {
  it("reads pass/fail/expect() counts", () => {
    const p = parseRunnerOutput("bun", " 44 pass\n 0 fail\n 159 expect() calls\n");
    expect(p).toMatchObject({
      pass: 44,
      fail: 0,
      assertions: 159,
      assertionSource: "expect-calls",
      unparseable: false,
    });
  });

  it("reads failures", () => {
    const p = parseRunnerOutput("bun", " 40 pass\n 4 fail\n 100 expect() calls");
    expect(p.fail).toBe(4);
  });

  it("falls back to test count when expect() calls are absent", () => {
    const p = parseRunnerOutput("bun", " 3 pass\n 0 fail");
    expect(p).toMatchObject({ assertions: 3, assertionSource: "tests" });
  });

  it("flags unparseable output", () => {
    expect(parseRunnerOutput("bun", "error: Cannot find module")).toMatchObject({
      pass: 0,
      fail: 0,
      assertionSource: "none",
      unparseable: true,
    });
  });
});

describe("parseRunnerOutput — vitest", () => {
  it("reads an all-passing summary", () => {
    const out = [
      " ✓ scripts/lib/x.test.ts (44 tests) 17ms",
      " Test Files  1 passed (1)",
      "      Tests  44 passed (44)",
    ].join("\n");
    expect(parseRunnerOutput("vitest", out)).toMatchObject({
      pass: 44,
      fail: 0,
      assertions: 44,
      assertionSource: "tests",
      unparseable: false,
    });
  });

  it("reads a mixed summary", () => {
    const out = "      Tests  2 failed | 42 passed (44)";
    expect(parseRunnerOutput("vitest", out)).toMatchObject({ pass: 42, fail: 2 });
  });

  it("strips ANSI colour codes before parsing", () => {
    const out = "\u001B[2m      Tests \u001B[22m \u001B[1m\u001B[32m44 passed\u001B[39m\u001B[22m";
    expect(parseRunnerOutput("vitest", out).pass).toBe(44);
  });

  it("treats 'no test files' as parseable-but-empty", () => {
    expect(parseRunnerOutput("vitest", "No test files found, exiting")).toMatchObject({
      pass: 0,
      fail: 0,
      unparseable: false,
    });
  });

  it("flags a crash as unparseable", () => {
    expect(parseRunnerOutput("vitest", "Error: Failed to load config").unparseable).toBe(true);
  });

  it("does not read bun-style counts as vitest results", () => {
    expect(parseRunnerOutput("vitest", " 44 pass\n 0 fail").unparseable).toBe(true);
  });
});

describe("stripAnsi", () => {
  it("removes colour codes only", () => {
    expect(stripAnsi("\u001B[31mred\u001B[39m text")).toBe("red text");
  });
});
