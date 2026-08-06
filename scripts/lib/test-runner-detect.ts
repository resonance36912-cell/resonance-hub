/**
 * Automatic test-runner detection for report generation.
 *
 * The redirect-safety suites are a mix: most are written against `bun:test`,
 * at least one (`return-to-allowlist-encoding.test.ts`) is written against
 * `vitest`. Running everything through one runner is fragile — the report
 * would silently mis-parse counts (or skip a suite) whenever a file switches
 * frameworks.
 *
 * This module detects the framework per file from its imports, builds the
 * right command, and normalizes both runners' summary output into one shape
 * so the report can present them consistently.
 */
import { readFileSync } from "node:fs";

export type TestRunner = "bun" | "vitest";

export type RunnerDetection = {
  runner: TestRunner;
  /** Why this runner was chosen — surfaced in the report for traceability. */
  reason: string;
};

const BUN_IMPORT = /\bfrom\s*["']bun:test["']|\brequire\(\s*["']bun:test["']\s*\)/;
const VITEST_IMPORT = /\bfrom\s*["']vitest["']|\brequire\(\s*["']vitest["']\s*\)/;

/**
 * Detect the framework a test file is written against.
 *
 * Precedence: an explicit `bun:test` import wins (a file can import helpers
 * from `vitest`-adjacent packages while running under Bun), then `vitest`,
 * then the `bun` default — `bun test` is the repo's configured runner
 * (`package.json` → `"test": "bun test scripts/lib/"`).
 */
export function detectRunner(file: string, source?: string): RunnerDetection {
  let text = source;
  if (text === undefined) {
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return { runner: "bun", reason: "file unreadable — defaulted to bun:test" };
    }
  }
  if (BUN_IMPORT.test(text)) {
    return { runner: "bun", reason: 'imports "bun:test"' };
  }
  if (VITEST_IMPORT.test(text)) {
    return { runner: "vitest", reason: 'imports "vitest"' };
  }
  return { runner: "bun", reason: "no framework import found — defaulted to bun:test" };
}

/** Command line used to execute a single suite with the detected runner. */
export function runnerCommand(runner: TestRunner, file: string): string[] {
  return runner === "vitest"
    ? ["bunx", "vitest", "run", "--reporter=default", file]
    : ["bun", "test", file];
}

/** Human label for the report / job log. */
export const RUNNER_LABEL: Record<TestRunner, string> = {
  bun: "bun:test",
  vitest: "vitest",
};

export type ParsedRunnerOutput = {
  pass: number;
  fail: number;
  assertions: number;
  /**
   * `expect-calls` — the runner reported real assertion counts (bun:test).
   * `tests`        — the runner does not report assertions (vitest), so the
   *                  test count is used as a lower bound.
   * `none`         — nothing parseable was found.
   */
  assertionSource: "expect-calls" | "tests" | "none";
  /** True when no summary line could be parsed (crash, config error, etc.). */
  unparseable: boolean;
};

/** Strip ANSI colour codes so summary regexes work on CI-coloured output. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, "");
}

function num(re: RegExp, text: string): number | null {
  const m = text.match(re);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/**
 * Normalize a runner's stdout+stderr into pass/fail/assertion counts.
 *
 * bun:test summary:  ` 44 pass`, ` 0 fail`, ` 159 expect() calls`
 * vitest summary:    ` Tests  44 passed (44)` / ` Tests  2 failed | 42 passed (44)`
 */
export function parseRunnerOutput(runner: TestRunner, rawOutput: string): ParsedRunnerOutput {
  const output = stripAnsi(rawOutput);

  if (runner === "vitest") {
    const testsLine = output.split("\n").find((l) => /^\s*Tests\s/.test(l)) ?? "";
    const pass = num(/(\d+)\s+passed/, testsLine);
    const fail = num(/(\d+)\s+failed/, testsLine);
    // Vitest's default reporter does not report assertion counts; fall back to
    // the test count so totals stay comparable across runners.
    const noTests = /No test files found/i.test(output);
    if (pass === null && fail === null) {
      return {
        pass: 0,
        fail: 0,
        assertions: 0,
        assertionSource: "none",
        unparseable: !noTests,
      };
    }
    return {
      pass: pass ?? 0,
      fail: fail ?? 0,
      assertions: pass ?? 0,
      assertionSource: "tests",
      unparseable: false,
    };
  }

  const pass = num(/(\d+)\s+pass\b/, output);
  const fail = num(/(\d+)\s+fail\b/, output);
  const expects = num(/(\d+)\s+expect\(\) calls/, output);
  if (pass === null && fail === null) {
    return { pass: 0, fail: 0, assertions: 0, assertionSource: "none", unparseable: true };
  }
  return {
    pass: pass ?? 0,
    fail: fail ?? 0,
    assertions: expects ?? pass ?? 0,
    assertionSource: expects === null ? "tests" : "expect-calls",
    unparseable: false,
  };
}
