// Schema + type-level guarantees for the two helpers the CI-health client
// consumes directly:
//
//   - `invalidRepoResult(repo, error)` must return an object that is
//     structurally a `RepoCiHealth`, so the dashboard can render an
//     invalid/inaccessible row through the same `RepoCard` code path as a
//     healthy one (no `undefined` field crashes at render time).
//   - `friendlyGithubError(err, repo)` must always return a `string` — the
//     UI feeds the value straight into JSX (`{repo.error}`) and into a
//     Tooltip, so `undefined` / `null` / objects would break rendering.
//
// The type assertions run at compile time; the runtime schema locks the
// wire shape so a future refactor can't silently drop or rename a field
// the client depends on.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  friendlyGithubError,
  GitHubApiError,
  invalidRepoResult,
  runRepoBatch,
  type RepoCiHealth,
  type WorkflowRun,
} from "../../src/lib/github-ci.functions";

// ---------------------------------------------------------------------------
// Compile-time assertions.
// If any of these fail to compile the test file itself won't build, which
// is exactly the guard we want.
// ---------------------------------------------------------------------------
type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// friendlyGithubError must return a plain string, not string | undefined.
type _FriendlyReturnsString = Expect<
  AssertEqual<ReturnType<typeof friendlyGithubError>, string>
>;

// invalidRepoResult must return the exact RepoCiHealth shape the UI reads.
type _InvalidReturnsRepoCiHealth = Expect<
  AssertEqual<ReturnType<typeof invalidRepoResult>, RepoCiHealth>
>;

// `error` on RepoCiHealth stays optional — healthy rows must be able to omit it.
type _ErrorIsOptional = Expect<
  AssertEqual<RepoCiHealth["error"], string | undefined>
>;

// ---------------------------------------------------------------------------
// Runtime schema. Mirrors the fields RepoCard / summary / RunDetailsDialog
// read in src/routes/admin.ci-health.tsx.
// ---------------------------------------------------------------------------
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

describe("client-facing contract: invalidRepoResult", () => {
  test("passes the RepoCiHealth runtime schema", () => {
    const r = invalidRepoResult("owner/repo", "boom");
    expect(() => RepoCiHealthSchema.parse(r)).not.toThrow();
  });

  test("populates every field the UI reads without introducing nulls where non-nullables live", () => {
    const r = invalidRepoResult("owner/repo", "boom");
    // Non-nullable strings the UI concatenates or renders directly.
    expect(typeof r.repo).toBe("string");
    expect(typeof r.html_url).toBe("string");
    expect(typeof r.default_branch).toBe("string");
    expect(typeof r.error).toBe("string");
    // Totals: every counter is a number; success_rate is nullable but must
    // actually be `null` for an invalid row (not `undefined`).
    for (const key of [
      "last",
      "success",
      "failure",
      "cancelled",
      "in_progress",
      "other",
    ] as const) {
      expect(typeof r.totals[key]).toBe("number");
    }
    expect(r.totals.success_rate).toBeNull();
    // Arrays are always arrays so `.map`/`.length` in the UI never explode.
    expect(Array.isArray(r.failing_runs)).toBe(true);
    expect(Array.isArray(r.recent_runs)).toBe(true);
    // Nullable run slots are `null`, not `undefined` — the UI uses `?? null`
    // patterns and JSX conditionals that assume that.
    expect(r.latest_run).toBeNull();
    expect(r.latest_default_branch_run).toBeNull();
  });

  test("shape is identical to what the client's `invalidRepos` filter targets", () => {
    // src/routes/admin.ci-health.tsx:
    //   rows.filter((r) => r.error && !r.default_branch)
    const r = invalidRepoResult("owner/repo", "boom");
    expect(Boolean(r.error) && !r.default_branch).toBe(true);
  });
});

describe("client-facing contract: friendlyGithubError", () => {
  test("always returns a non-empty string, regardless of input shape", () => {
    const inputs: unknown[] = [
      new GitHubApiError(404, ""),
      new GitHubApiError(401, ""),
      new GitHubApiError(403, ""),
      new GitHubApiError(429, ""),
      new GitHubApiError(503, ""),
      new GitHubApiError(418, ""),
      new Error("boom"),
      new Error(""),
      new TypeError("nope"),
      "raw string",
      null,
      undefined,
      { message: "custom" },
      42,
    ];
    for (const err of inputs) {
      const out = friendlyGithubError(err, "owner/repo");
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    }
  });

  test("output is directly renderable — no leaked provider stack traces or serialized bodies", () => {
    const err = new GitHubApiError(500, "<html><body>Internal error trace ...</body></html>");
    const out = friendlyGithubError(err, "owner/repo");
    expect(out).not.toContain("<html>");
    expect(out).not.toContain("trace");
    // Follows the "GitHub is unavailable (HTTP 5xx)" copy the UI advertises.
    expect(out).toMatch(/^GitHub is unavailable \(HTTP \d{3}\)$/);
  });
});

describe("runRepoBatch: whole-batch response shape", () => {
  test("every row in `repos` conforms to RepoCiHealth, whether healthy or errored", async () => {
    const { repos, invalidCount } = await runRepoBatch(
      ["good/one", "bad slug", "missing/x"],
      async (r) => {
        if (r === "missing/x") throw new GitHubApiError(404, "");
        return {
          repo: r,
          html_url: `https://github.com/${r}`,
          default_branch: "main",
          totals: {
            last: 1,
            success: 1,
            failure: 0,
            cancelled: 0,
            in_progress: 0,
            other: 0,
            success_rate: 1,
          },
          latest_run: null,
          latest_default_branch_run: null,
          failing_runs: [],
          recent_runs: [],
        };
      },
    );
    expect(typeof invalidCount).toBe("number");
    for (const row of repos) {
      expect(() => RepoCiHealthSchema.parse(row)).not.toThrow();
    }
  });
});
