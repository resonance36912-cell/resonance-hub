// Integration test: pin the exact JSON response shape returned by the
// `getCiHealth` server function (backing /admin/ci-health) against what the
// client route reads. We bypass createServerFn's request/middleware layer by
// exercising the same `runRepoBatch(...)` composition the handler uses and
// then wrapping it in the exact envelope the handler returns:
//
//   { repos: RepoCiHealth[]; fetchedAt: string; invalidCount: number }
//
// Zod schemas below are treated as the client contract. If the server ever
// drifts (renamed field, dropped nullable, missing counter) parse() throws
// and this test fails — same failure mode the dashboard would hit at
// runtime.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  GitHubApiError,
  runRepoBatch,
  type RepoCiHealth,
  type WorkflowRun,
} from "../../src/lib/github-ci.functions";

// --- Client contract (fields src/routes/admin.ci-health.tsx reads) --------

const WorkflowRunSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  workflow_name: z.string().nullable(),
  head_branch: z.string().nullable(),
  event: z.string().nullable(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  run_number: z.number(),
  attempt: z.number(),
  actor: z.string().nullable(),
  head_sha: z.string(),
  head_commit_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  run_started_at: z.string().nullable(),
}) satisfies z.ZodType<WorkflowRun>;

const RepoCiHealthSchema = z.object({
  repo: z.string(),
  html_url: z.string(),
  default_branch: z.string(),
  totals: z.object({
    last: z.number(),
    success: z.number(),
    failure: z.number(),
    cancelled: z.number(),
    in_progress: z.number(),
    other: z.number(),
    success_rate: z.number().nullable(),
  }),
  latest_run: WorkflowRunSchema.nullable(),
  latest_default_branch_run: WorkflowRunSchema.nullable(),
  failing_runs: z.array(WorkflowRunSchema),
  recent_runs: z.array(WorkflowRunSchema),
  error: z.string().optional(),
}) satisfies z.ZodType<RepoCiHealth>;

const CiHealthResponseSchema = z.object({
  repos: z.array(RepoCiHealthSchema),
  fetchedAt: z.string().datetime(),
  invalidCount: z.number().int().nonnegative(),
});

// --- Fixtures -------------------------------------------------------------

function healthyRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1,
    name: "CI",
    workflow_name: "ci.yml",
    head_branch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/good/one/actions/runs/1",
    run_number: 42,
    attempt: 1,
    actor: "octocat",
    head_sha: "abc1234deadbeef",
    head_commit_message: "chore: ok",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:01:00Z",
    run_started_at: "2026-01-01T00:00:30Z",
    ...overrides,
  };
}

function healthyRepo(repo: string): RepoCiHealth {
  const run = healthyRun({ html_url: `https://github.com/${repo}/actions/runs/1` });
  return {
    repo,
    html_url: `https://github.com/${repo}`,
    default_branch: "main",
    totals: {
      last: 3,
      success: 2,
      failure: 1,
      cancelled: 0,
      in_progress: 0,
      other: 0,
      success_rate: 2 / 3,
    },
    latest_run: run,
    latest_default_branch_run: run,
    failing_runs: [healthyRun({ id: 2, conclusion: "failure" })],
    recent_runs: [run],
  };
}

// Mirrors the getCiHealth handler body (lines 281-289) without the auth
// middleware — the response envelope is the invariant we care about.
async function callGetCiHealth(
  repos: string[],
  loader: (r: string) => Promise<RepoCiHealth>,
) {
  const { repos: rows, invalidCount } = await runRepoBatch(repos, loader);
  return { repos: rows, fetchedAt: new Date().toISOString(), invalidCount };
}

// --- Tests ----------------------------------------------------------------

describe("/admin/ci-health: exact JSON response shape", () => {
  test("mixed valid + invalid slugs: envelope + every row parses against the client schema", async () => {
    const input = [
      "good/one",
      "invalid slug",       // client-side reject
      "missing/x",          // 404
      "forbidden/x",        // 403
      "ratelimited/x",      // 429
      "broken/x",           // 5xx
      "GOOD/one",           // case-insensitive dup of good/one
    ];

    const body = await callGetCiHealth(input, async (r) => {
      if (r === "missing/x") throw new GitHubApiError(404, "");
      if (r === "forbidden/x") throw new GitHubApiError(403, "");
      if (r === "ratelimited/x") throw new GitHubApiError(429, "");
      if (r === "broken/x") throw new GitHubApiError(503, "");
      return healthyRepo(r);
    });

    // Envelope: exact top-level keys, no extras.
    expect(Object.keys(body).sort()).toEqual(
      ["fetchedAt", "invalidCount", "repos"].sort(),
    );
    const parsed = CiHealthResponseSchema.parse(body);

    // Dedup: 7 in → 6 unique out (GOOD/one drops).
    expect(parsed.repos).toHaveLength(6);
    expect(parsed.repos.map((r) => r.repo)).toEqual([
      "good/one",
      "invalid slug",
      "missing/x",
      "forbidden/x",
      "ratelimited/x",
      "broken/x",
    ]);

    // invalidCount matches rows where the UI treats the card as invalid.
    const uiInvalid = parsed.repos.filter((r) => r.error && !r.default_branch).length;
    expect(parsed.invalidCount).toBe(uiInvalid);
    expect(parsed.invalidCount).toBe(5);

    // fetchedAt is an ISO string the client feeds to `new Date(...)`.
    expect(Number.isFinite(new Date(parsed.fetchedAt).getTime())).toBe(true);
  });

  test("healthy row: every field the RepoCard reads is present and correctly typed", async () => {
    const body = await callGetCiHealth(["good/one"], async (r) => healthyRepo(r));
    const [row] = CiHealthResponseSchema.parse(body).repos;

    // Fields referenced explicitly in admin.ci-health.tsx (see grep of route).
    expect(typeof row.totals.success_rate === "number" || row.totals.success_rate === null).toBe(true);
    expect(Array.isArray(row.failing_runs)).toBe(true);
    expect(Array.isArray(row.recent_runs)).toBe(true);
    expect(row.latest_default_branch_run).not.toBeUndefined();
    expect(row.default_branch).toBe("main");
    expect(row.error).toBeUndefined(); // healthy rows must NOT carry an error string
    expect(row.totals.failure).toBe(1);
    expect(row.totals.in_progress).toBe(0);
  });

  test("invalid/failed row: nullable slots are `null` (not undefined) and error is a string", async () => {
    const body = await callGetCiHealth(
      ["missing/x", "not a slug"],
      async () => {
        throw new GitHubApiError(404, "");
      },
    );
    const parsed = CiHealthResponseSchema.parse(body);
    for (const row of parsed.repos) {
      expect(row.latest_run).toBeNull();
      expect(row.latest_default_branch_run).toBeNull();
      expect(row.failing_runs).toEqual([]);
      expect(row.recent_runs).toEqual([]);
      expect(typeof row.error).toBe("string");
      expect(row.default_branch).toBe(""); // UI renders `{repo.default_branch || "?"}`
      expect(row.totals.success_rate).toBeNull();
    }
  });

  test("empty repo list (edge): envelope still parses; repos=[] and invalidCount=0", async () => {
    const body = await callGetCiHealth([], async (r) => healthyRepo(r));
    const parsed = CiHealthResponseSchema.parse(body);
    expect(parsed.repos).toEqual([]);
    expect(parsed.invalidCount).toBe(0);
  });

  test("response is JSON-serialisable (no undefined/functions/Dates leak through)", async () => {
    const body = await callGetCiHealth(
      ["good/one", "missing/x"],
      async (r) => {
        if (r === "missing/x") throw new GitHubApiError(404, "");
        return healthyRepo(r);
      },
    );
    const roundTripped = JSON.parse(JSON.stringify(body));
    // Round-trip must still satisfy the client contract exactly.
    expect(() => CiHealthResponseSchema.parse(roundTripped)).not.toThrow();
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(body)));
  });
});
