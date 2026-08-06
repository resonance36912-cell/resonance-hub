import { describe, expect, it } from "bun:test";
import {
  buildBaselineMetadata,
  decidePromotion,
  describeBaseline,
  type BaselineSummary,
} from "./baseline-promote";

const GREEN: BaselineSummary = {
  generatedAt: "2026-08-06T19:00:00.000Z",
  commit: "abcdef1234567890",
  totals: { pass: 146, fail: 0, assertions: 4257 },
  suites: [
    { id: "fuzz", status: "pass" },
    { id: "encoding", status: "flaky" },
  ],
};
const MAIN_PUSH = { eventName: "push", ref: "refs/heads/main", runId: "42", runNumber: "7" };

describe("decidePromotion", () => {
  it("promotes a green push to main", () => {
    const d = decidePromotion(GREEN, MAIN_PUSH);
    expect(d.promote).toBe(true);
    expect(d.reason).toContain("promoting as the new baseline");
  });

  it("allows flaky-but-passing suites", () => {
    expect(decidePromotion(GREEN, MAIN_PUSH).promote).toBe(true);
  });

  it("refuses pull requests and non-main refs", () => {
    expect(decidePromotion(GREEN, { ...MAIN_PUSH, eventName: "pull_request" }).blockedBy).toBe("event");
    expect(decidePromotion(GREEN, { ...MAIN_PUSH, ref: "refs/heads/feature" }).blockedBy).toBe("branch");
  });

  it("refuses failing, empty, suite-less and missing summaries", () => {
    expect(
      decidePromotion({ ...GREEN, totals: { pass: 100, fail: 3, assertions: 1 } }, MAIN_PUSH).blockedBy,
    ).toBe("failing");
    expect(decidePromotion({ ...GREEN, totals: { pass: 0, fail: 0 } }, MAIN_PUSH).blockedBy).toBe("empty");
    expect(decidePromotion({ ...GREEN, suites: [] }, MAIN_PUSH).blockedBy).toBe("no-suites");
    expect(decidePromotion(null, MAIN_PUSH).blockedBy).toBe("missing-summary");
    expect(
      decidePromotion({ ...GREEN, suites: [{ id: "fuzz", status: "fail" }] }, MAIN_PUSH).blockedBy,
    ).toBe("failing");
  });

  it("honours a forced reseed but never for a red run", () => {
    expect(decidePromotion(GREEN, { eventName: "workflow_dispatch", ref: "refs/heads/x", force: "1" }).promote).toBe(true);
    expect(
      decidePromotion({ ...GREEN, totals: { pass: 1, fail: 1 } }, { eventName: "push", ref: "refs/heads/main", force: "1" })
        .promote,
    ).toBe(false);
  });

  it("tracks a custom baseline branch", () => {
    expect(
      decidePromotion(GREEN, { eventName: "push", ref: "refs/heads/release", defaultBranch: "release" }).promote,
    ).toBe(true);
  });
});

describe("metadata", () => {
  it("captures commit, run and totals", () => {
    const meta = buildBaselineMetadata(GREEN, MAIN_PUSH, new Date("2026-08-06T20:00:00.000Z"));
    expect(meta).toMatchObject({
      promotedAt: "2026-08-06T20:00:00.000Z",
      commit: "abcdef1234567890",
      runNumber: 7,
      branch: "main",
    });
    expect(meta.totals.pass).toBe(146);
    expect(meta.suites).toHaveLength(2);
  });

  it("describes the baseline for the job log", () => {
    const meta = buildBaselineMetadata(GREEN, MAIN_PUSH);
    expect(describeBaseline(meta)).toContain("abcdef123456");
    expect(describeBaseline(null)).toContain("no promoted baseline");
  });
});
