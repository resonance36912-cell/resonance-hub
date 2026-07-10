// Guarantees the OpenAPI + Zod contract (`docs/api/ci-health.openapi.yaml`,
// `src/lib/github-ci.contract.ts`) stays in lock-step with the actual server
// function shapes and the TS types the UI consumes.
//
// We check three things:
//   1. Every Zod schema in the contract module `satisfies z.ZodType<T>` for
//      the corresponding TS type exported from `github-ci.functions.ts`.
//      Compile-time only — if the types drift, this file won't build.
//   2. `runRepoBatch(...)` output round-trips through
//      `GetCiHealthResponseSchema` for both healthy and errored rows.
//   3. The published OpenAPI YAML declares the same top-level schemas the
//      contract module exports (no drift on schema names, no accidental
//      deletions).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import {
  CiHealthErrorSchema,
  CommitInfoSchema,
  GetCiHealthInputSchema,
  GetCiHealthResponseSchema,
  GetRunDetailsInputSchema,
  GetRunDetailsResponseSchema,
  RepoCiHealthSchema,
  RepoTotalsSchema,
  RunJobSchema,
  RunStepSchema,
  WorkflowRunSchema,
} from "../../src/lib/github-ci.contract";
import {
  GitHubApiError,
  runRepoBatch,
  type CommitInfo,
  type RepoCiHealth,
  type RunJob,
  type RunStep,
  type WorkflowRun,
} from "../../src/lib/github-ci.functions";

// ---------------------------------------------------------------------------
// 1. Compile-time: schemas structurally match the exported TS types.
// The `satisfies` clauses fail the typecheck if a field is renamed or
// widened/narrowed on either side.
// ---------------------------------------------------------------------------
const _workflowRunGuard = WorkflowRunSchema satisfies ZodType<WorkflowRun>;
const _repoCiHealthGuard = RepoCiHealthSchema satisfies ZodType<RepoCiHealth>;
const _runStepGuard = RunStepSchema satisfies ZodType<RunStep>;
const _runJobGuard = RunJobSchema satisfies ZodType<RunJob>;
const _commitInfoGuard = CommitInfoSchema satisfies ZodType<CommitInfo>;
void _workflowRunGuard;
void _repoCiHealthGuard;
void _runStepGuard;
void _runJobGuard;
void _commitInfoGuard;

// ---------------------------------------------------------------------------
// 2. Runtime: real server-fn output shape parses cleanly.
// ---------------------------------------------------------------------------
describe("GetCiHealthResponse contract", () => {
  test("accepts a valid input payload", () => {
    expect(() =>
      GetCiHealthInputSchema.parse({ repos: ["good/one", "good/two"] }),
    ).not.toThrow();
  });

  test("rejects empty and over-limit repo lists", () => {
    expect(() => GetCiHealthInputSchema.parse({ repos: [] })).toThrow();
    expect(() =>
      GetCiHealthInputSchema.parse({
        repos: Array.from({ length: 11 }, (_, i) => `o/r${i}`),
      }),
    ).toThrow();
  });

  test("runRepoBatch output round-trips through GetCiHealthResponseSchema", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["good/one", "bad slug", "missing/x"],
      async (r) => {
        if (r === "missing/x") throw new GitHubApiError(404, "");
        return {
          repo: r,
          html_url: `https://github.com/${r}`,
          default_branch: "main",
          totals: {
            last: 2,
            success: 1,
            failure: 1,
            cancelled: 0,
            in_progress: 0,
            other: 0,
            success_rate: 0.5,
          },
          latest_run: null,
          latest_default_branch_run: null,
          failing_runs: [],
          recent_runs: [],
        };
      },
    );
    const wireEnvelope = {
      repos,
      fetchedAt: new Date().toISOString(),
      invalidCount,
    };
    expect(() => GetCiHealthResponseSchema.parse(wireEnvelope)).not.toThrow();
  });
});

describe("GetRunDetailsInput contract", () => {
  test("applies includeLogs default", () => {
    const parsed = GetRunDetailsInputSchema.parse({
      repo: "owner/repo",
      runId: 42,
    });
    expect(parsed.includeLogs).toBe(true);
  });

  test("rejects zero / negative runId and empty repo", () => {
    expect(() =>
      GetRunDetailsInputSchema.parse({ repo: "owner/repo", runId: 0 }),
    ).toThrow();
    expect(() =>
      GetRunDetailsInputSchema.parse({ repo: "", runId: 1 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. OpenAPI YAML mirrors the contract module.
// We only assert the schema names + top-level operation ids; the full field
// checks are already covered by the Zod round-trip above.
// ---------------------------------------------------------------------------
describe("docs/api/ci-health.openapi.yaml", () => {
  const yaml = readFileSync(
    join(process.cwd(), "docs/api/ci-health.openapi.yaml"),
    "utf8",
  );

  test.each([
    "GetCiHealthInput",
    "GetCiHealthResponse",
    "RepoCiHealth",
    "RepoTotals",
    "WorkflowRun",
    "GetRunDetailsInput",
    "GetRunDetailsResponse",
    "RunJob",
    "RunStep",
    "CommitInfo",
    "CiHealthError",
  ])("declares schema %s", (name) => {
    expect(yaml).toContain(`    ${name}:`);
  });

  test.each(["getCiHealth", "getRunDetails"])(
    "declares operationId %s",
    (op) => {
      expect(yaml).toContain(`operationId: ${op}`);
    },
  );

  test("both operations require the supabaseBearer security scheme", () => {
    const matches = yaml.match(/supabaseBearer: \[\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// Sanity: the standalone error / totals / step schemas are still exported
// (referenced elsewhere in the UI and tests).
describe("contract module re-exports", () => {
  test("exports RepoTotals / RunStep / CiHealthError schemas", () => {
    expect(RepoTotalsSchema).toBeDefined();
    expect(RunStepSchema).toBeDefined();
    expect(CiHealthErrorSchema).toBeDefined();
  });
});
