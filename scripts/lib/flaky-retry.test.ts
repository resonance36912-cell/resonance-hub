import { describe, expect, it } from "bun:test";
import {
  attemptFailed,
  authoritativeAttempt,
  classifyAttempts,
  jobShouldFail,
  retriesEnabled,
  shouldRetry,
  type Attempt,
} from "./flaky-retry";

const a = (pass: number, fail: number, output = ""): Attempt => ({
  pass,
  fail,
  assertions: pass,
  durationMs: 10,
  output,
});

describe("attemptFailed", () => {
  it("treats reported failures as failing", () => {
    expect(attemptFailed(a(10, 1))).toBe(true);
  });
  it("treats an empty/unparseable run as failing", () => {
    expect(attemptFailed(a(0, 0))).toBe(true);
  });
  it("treats a clean run as passing", () => {
    expect(attemptFailed(a(10, 0))).toBe(false);
  });
});

describe("shouldRetry", () => {
  it("retries only failing suites", () => {
    expect(shouldRetry(a(10, 1))).toBe(true);
    expect(shouldRetry(a(10, 0))).toBe(false);
  });
  it("never retries when retries are disabled", () => {
    expect(shouldRetry(a(10, 1), false)).toBe(false);
  });
});

describe("classifyAttempts", () => {
  it("passes first time", () => {
    expect(classifyAttempts(a(10, 0), null)).toBe("stable-pass");
  });
  it("marks fail-then-pass as flaky", () => {
    expect(classifyAttempts(a(9, 1), a(10, 0))).toBe("flaky");
  });
  it("fails when the failure reproduces", () => {
    expect(classifyAttempts(a(9, 1), a(9, 1))).toBe("reproduced-failure");
  });
  it("fails when the retry was skipped", () => {
    expect(classifyAttempts(a(9, 1), null)).toBe("reproduced-failure");
  });
  it("fails when the retry produced no parseable results", () => {
    expect(classifyAttempts(a(0, 0), a(0, 0))).toBe("reproduced-failure");
  });
});

describe("authoritativeAttempt", () => {
  it("uses the passing retry for a flaky suite", () => {
    expect(authoritativeAttempt(a(9, 1, "first"), a(10, 0, "retry")).output).toBe("retry");
  });
  it("uses the retry output when the failure reproduces", () => {
    expect(authoritativeAttempt(a(9, 1, "first"), a(9, 1, "retry")).output).toBe("retry");
  });
  it("uses the first attempt when no retry ran", () => {
    expect(authoritativeAttempt(a(9, 1, "first"), null).output).toBe("first");
  });
});

describe("retriesEnabled", () => {
  it("defaults to on", () => {
    expect(retriesEnabled({})).toBe(true);
  });
  it("honours the opt-out", () => {
    expect(retriesEnabled({ RETURN_TO_COVERAGE_NO_RETRY: "1" })).toBe(false);
    expect(retriesEnabled({ RETURN_TO_COVERAGE_NO_RETRY: "true" })).toBe(false);
  });
});

describe("jobShouldFail", () => {
  it("stays green for flaky-only runs", () => {
    expect(jobShouldFail(["stable-pass", "flaky"])).toBe(false);
  });
  it("goes red on a reproduced failure", () => {
    expect(jobShouldFail(["flaky", "reproduced-failure"])).toBe(true);
  });
});
