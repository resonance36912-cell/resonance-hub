/**
 * Flaky-suite classification for the return_to coverage report.
 *
 * Policy: a suite that fails is re-run exactly once. The job only goes red when
 * the failure reproduces on that second attempt. A suite that failed first and
 * passed on retry is reported as FLAKY — visible everywhere (job log, report,
 * PR comment, history) but non-blocking, so real regressions stay red while
 * genuine nondeterminism does not block merges.
 *
 * The rules live here as pure functions so they can be unit-tested without
 * spawning any test runner.
 */

/** Normalized outcome of one runner invocation. */
export type Attempt = {
  pass: number;
  fail: number;
  assertions: number;
  durationMs: number;
  output: string;
};

export type FlakyVerdict =
  /** Passed on the first attempt. */
  | "stable-pass"
  /** Failed, then passed when re-run once — reported, but does not fail the job. */
  | "flaky"
  /** Failed on both attempts (or retries were disabled) — fails the job. */
  | "reproduced-failure";

/**
 * A run counts as failing when the runner reported failures OR reported nothing
 * at all (an empty/unparseable run must never read as "0 failures, all good").
 */
export function attemptFailed(a: Attempt): boolean {
  return a.fail > 0 || a.pass === 0;
}

/** Whether a failing first attempt should trigger the single retry. */
export function shouldRetry(first: Attempt, retriesEnabled = true): boolean {
  return retriesEnabled && attemptFailed(first);
}

/**
 * Classify a suite from its first attempt and (when it failed) its retry.
 * `retry === null` means the retry was skipped/disabled, which is treated as a
 * reproduced failure rather than silently passing.
 */
export function classifyAttempts(first: Attempt, retry: Attempt | null): FlakyVerdict {
  if (!attemptFailed(first)) return "stable-pass";
  if (!retry) return "reproduced-failure";
  return attemptFailed(retry) ? "reproduced-failure" : "flaky";
}

/** The attempt whose counts represent the suite in the report. */
export function authoritativeAttempt(first: Attempt, retry: Attempt | null): Attempt {
  // For a flaky suite the passing retry is authoritative; otherwise the failing
  // run is what reviewers need to see.
  if (retry && !attemptFailed(retry)) return retry;
  return retry ?? first;
}

/** Retries are on by default; set RETURN_TO_COVERAGE_NO_RETRY=1 to disable. */
export function retriesEnabled(env: Record<string, string | undefined>): boolean {
  const v = env["RETURN_TO_COVERAGE_NO_RETRY"];
  return !(v === "1" || v === "true");
}

export const VERDICT_LABEL: Record<FlakyVerdict, string> = {
  "stable-pass": "PASS",
  flaky: "FLAKY",
  "reproduced-failure": "FAIL",
};

/** Only reproduced failures may fail the job. */
export function jobShouldFail(verdicts: FlakyVerdict[]): boolean {
  return verdicts.some((v) => v === "reproduced-failure");
}
