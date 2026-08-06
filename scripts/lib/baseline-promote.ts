/**
 * Baseline promotion for the `return_to` coverage trend.
 *
 * The trend section compares the current run against the last successful run's
 * `summary.json`. Scanning workflow runs for that file is fragile: artifacts
 * expire, a "successful" run can still be a partially-parsed run, and the
 * lookup has to walk run history every time.
 *
 * Instead, a passing push to `main` PROMOTES its own summary into a single
 * stable-named artifact (`return-to-baseline`) that every later PR downloads
 * directly. This module decides whether a summary is fit to become that
 * baseline and builds the promotion payload.
 */

export type BaselineSummary = {
  generatedAt?: string | null;
  commit?: string | null;
  totals?: { pass?: number; fail?: number; assertions?: number } | null;
  suites?: { id: string; status?: string; pass?: number; fail?: number }[] | null;
};

export type PromotionContext = {
  /** `push` / `pull_request` / `workflow_dispatch`. */
  eventName: string | undefined;
  /** e.g. `refs/heads/main`. */
  ref: string | undefined;
  /** Branch the baseline is tracked on. */
  defaultBranch?: string;
  runId?: string | undefined;
  runNumber?: string | undefined;
  /** Set to `1`/`true` to promote regardless of branch/event (manual reseed). */
  force?: string | undefined;
};

export type PromotionDecision = {
  promote: boolean;
  /** Human-readable reason, printed in the job log either way. */
  reason: string;
  /** Set when a rule blocked promotion despite the branch/event being right. */
  blockedBy?: "event" | "branch" | "missing-summary" | "failing" | "empty" | "no-suites";
};

const DEFAULT_BRANCH = "main";

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/**
 * A baseline must be a real, green, non-empty run on the tracked branch.
 *
 * Flaky suites (failed once, passed on the retry) are allowed — the job itself
 * treats them as non-blocking, so excluding them would starve the baseline.
 */
export function decidePromotion(
  summary: BaselineSummary | null,
  ctx: PromotionContext,
): PromotionDecision {
  const branch = ctx.defaultBranch ?? DEFAULT_BRANCH;
  const forced = truthy(ctx.force);

  if (!summary) {
    return { promote: false, reason: "No summary.json produced — nothing to promote.", blockedBy: "missing-summary" };
  }
  const pass = summary.totals?.pass ?? 0;
  const fail = summary.totals?.fail ?? 0;
  const suites = summary.suites ?? [];

  if (fail > 0) {
    return {
      promote: false,
      reason: `Run has ${fail} failing test(s) — baseline left untouched.`,
      blockedBy: "failing",
    };
  }
  if (pass === 0) {
    return {
      promote: false,
      reason: "Run recorded 0 passing tests — refusing to promote an empty baseline.",
      blockedBy: "empty",
    };
  }
  if (suites.length === 0) {
    return {
      promote: false,
      reason: "Run recorded no suites — refusing to promote a baseline with nothing to compare.",
      blockedBy: "no-suites",
    };
  }
  if (suites.some((s) => s.status === "fail")) {
    return {
      promote: false,
      reason: "At least one suite reproduced a failure — baseline left untouched.",
      blockedBy: "failing",
    };
  }

  if (forced) {
    return { promote: true, reason: `Forced promotion (${pass} passing across ${suites.length} suites).` };
  }
  if (ctx.eventName !== "push") {
    return {
      promote: false,
      reason: `Event "${ctx.eventName ?? "unknown"}" does not update the baseline — only pushes to ${branch} do.`,
      blockedBy: "event",
    };
  }
  if (ctx.ref !== `refs/heads/${branch}`) {
    return {
      promote: false,
      reason: `Ref "${ctx.ref ?? "unknown"}" is not ${branch} — baseline unchanged.`,
      blockedBy: "branch",
    };
  }
  return {
    promote: true,
    reason: `Green push to ${branch} (${pass} passing across ${suites.length} suites) — promoting as the new baseline.`,
  };
}

export type BaselineMetadata = {
  promotedAt: string;
  commit: string | null;
  generatedAt: string | null;
  runId: string | null;
  runNumber: number | null;
  branch: string;
  totals: { pass: number; fail: number; assertions: number };
  suites: { id: string; status: string }[];
};

/** Sidecar written next to the promoted summary so runs can explain the baseline. */
export function buildBaselineMetadata(
  summary: BaselineSummary,
  ctx: PromotionContext,
  now = new Date(),
): BaselineMetadata {
  return {
    promotedAt: now.toISOString(),
    commit: summary.commit ?? null,
    generatedAt: summary.generatedAt ?? null,
    runId: ctx.runId ?? null,
    runNumber: ctx.runNumber ? Number(ctx.runNumber) : null,
    branch: ctx.defaultBranch ?? DEFAULT_BRANCH,
    totals: {
      pass: summary.totals?.pass ?? 0,
      fail: summary.totals?.fail ?? 0,
      assertions: summary.totals?.assertions ?? 0,
    },
    suites: (summary.suites ?? []).map((s) => ({ id: s.id, status: s.status ?? "unknown" })),
  };
}

/** One-line log summary of a baseline sidecar, for the download step. */
export function describeBaseline(meta: BaselineMetadata | null): string {
  if (!meta) return "no promoted baseline available — the trend will start from this run";
  return `baseline commit ${(meta.commit ?? "unknown").slice(0, 12)} · run ${
    meta.runNumber ? `#${meta.runNumber}` : (meta.runId ?? "unknown")
  } · ${meta.totals.pass} passing · promoted ${meta.promotedAt}`;
}
